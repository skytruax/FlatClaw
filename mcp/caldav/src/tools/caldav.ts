import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createDAVClient,
  freeBusyQuery,
  type DAVCalendar,
  type DAVCalendarObject,
} from "tsdav";
import nodemailer from "nodemailer";
import { resolveCreds, type MailboxCreds } from "../auth.js";
import { handleToolCall, formatData, formatSuccess } from "../tool-helpers.js";
import {
  buildVCalendar,
  parseFirstVEvent,
  type AttendeePartStat,
} from "../ical.js";

/**
 * CalDAV tools — calendars + events + iTIP scheduling.
 *
 * cPanel CCS (and most SabreDAV-derived servers) does NOT auto-dispatch
 * iTIP messages on PUT, so the MCP owns the wire: any tool that adds
 * attendees must also send the iMIP email itself, and the same for
 * CANCEL / REPLY. The shared `buildVCalendar` helper + `nodemailer.icalEvent`
 * keep all that consistent.
 */

async function makeDavClient(creds: MailboxCreds) {
  return await createDAVClient({
    serverUrl: creds.davUrl,
    credentials: { username: creds.email, password: creds.password },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
}

async function findCalendar(
  client: Awaited<ReturnType<typeof createDAVClient>>,
  calendarUrl: string,
): Promise<DAVCalendar> {
  const calendars = await client.fetchCalendars();
  const cal = calendars.find((c) => c.url === calendarUrl);
  if (!cal) {
    throw new Error(
      `calendar not found: ${calendarUrl}. Run caldav_list_calendars to see valid URLs.`,
    );
  }
  return cal;
}

async function findEvent(
  client: Awaited<ReturnType<typeof createDAVClient>>,
  cal: DAVCalendar,
  eventUrl: string,
): Promise<DAVCalendarObject> {
  const objs = await client.fetchCalendarObjects({
    calendar: cal,
    objectUrls: [eventUrl],
  });
  const obj = objs.find((o) => o.url === eventUrl);
  if (!obj) throw new Error(`event not found in calendar: ${eventUrl}`);
  return obj;
}

const attendeeSchema = z.object({
  email: z.string(),
  name: z.string().optional(),
  partStat: z
    .enum(["NEEDS-ACTION", "ACCEPTED", "DECLINED", "TENTATIVE", "DELEGATED"])
    .optional(),
  rsvp: z.boolean().optional(),
  role: z
    .enum(["REQ-PARTICIPANT", "OPT-PARTICIPANT", "CHAIR"])
    .optional(),
});

export function registerCaldavTools(server: McpServer) {
  // ---- read ---------------------------------------------------------

  server.tool(
    "caldav_list_calendars",
    "List the calendars on the user's CalDAV account.",
    {},
    async () =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const client = await makeDavClient(creds);
        const calendars = await client.fetchCalendars();
        return formatData(
          calendars.map((c) => ({
            url: c.url,
            displayName: c.displayName,
            description: c.description,
            ctag: c.ctag,
            timezone: c.timezone,
            components: c.components,
          })),
        );
      }),
  );

  server.tool(
    "caldav_list_events",
    "List events from one of the user's CalDAV calendars within a time range. Defaults to 'today'. Returns parsed event fields plus the raw iCalendar.",
    {
      calendarUrl: z.string(),
      startISO: z.string().optional(),
      endISO: z.string().optional(),
    },
    async ({ calendarUrl, startISO, endISO }) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const client = await makeDavClient(creds);
        const cal = await findCalendar(client, calendarUrl);
        const now = new Date();
        const startOfDay = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
        );
        const endOfDay = new Date(startOfDay.getTime() + 24 * 3600 * 1000 - 1);
        const start = startISO ? new Date(startISO) : startOfDay;
        const end = endISO ? new Date(endISO) : endOfDay;
        const objects = await client.fetchCalendarObjects({
          calendar: cal,
          timeRange: { start: start.toISOString(), end: end.toISOString() },
        });
        return formatData(
          objects.map((o) => {
            const parsed = parseFirstVEvent(o.data ?? "");
            return {
              url: o.url,
              etag: o.etag,
              uid: parsed?.uid,
              summary: parsed?.summary,
              start: parsed?.start,
              end: parsed?.end,
              location: parsed?.location,
              description: parsed?.description,
              status: parsed?.status,
              organizer: parsed?.organizer,
              attendees: parsed?.attendees,
              sequence: parsed?.sequence,
              rrule: parsed?.rrule,
              data: o.data,
            };
          }),
        );
      }),
  );

  server.tool(
    "caldav_search_events",
    "Search across all (or specific) calendars within a time range, optionally filtering by summary substring or attendee email.",
    {
      startISO: z.string(),
      endISO: z.string(),
      query: z.string().optional().describe("Substring match on SUMMARY."),
      attendee: z.string().optional().describe("Match if any ATTENDEE has this email."),
      calendarUrls: z.array(z.string()).optional(),
    },
    async ({ startISO, endISO, query, attendee, calendarUrls }) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const client = await makeDavClient(creds);
        const cals = await client.fetchCalendars();
        const targets = calendarUrls
          ? cals.filter((c) => calendarUrls.includes(c.url))
          : cals;
        const out: unknown[] = [];
        for (const cal of targets) {
          const objects = await client.fetchCalendarObjects({
            calendar: cal,
            timeRange: { start: startISO, end: endISO },
          });
          for (const o of objects) {
            const parsed = parseFirstVEvent(o.data ?? "");
            if (!parsed) continue;
            if (query && !parsed.summary?.toLowerCase().includes(query.toLowerCase())) continue;
            if (
              attendee &&
              !parsed.attendees.some(
                (a) => a.email.toLowerCase() === attendee.toLowerCase(),
              )
            )
              continue;
            out.push({
              calendarUrl: cal.url,
              url: o.url,
              etag: o.etag,
              uid: parsed.uid,
              summary: parsed.summary,
              start: parsed.start,
              end: parsed.end,
              attendees: parsed.attendees,
            });
          }
        }
        return formatData(out);
      }),
  );

  server.tool(
    "caldav_freebusy",
    "RFC 4791 free/busy query against the user's calendar within a window. Returns busy time blocks (other-attendee FB requires server-side principal mapping which cPanel CCS does not always expose; this returns the user's own FB).",
    {
      startISO: z.string(),
      endISO: z.string(),
    },
    async ({ startISO, endISO }) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const client = await makeDavClient(creds);
        const cals = await client.fetchCalendars();
        const home = cals[0]?.url; // freeBusyQuery wants a calendar/home URL
        if (!home) throw new Error("no calendars available");
        // freeBusyQuery is a standalone tsdav export — it doesn't get bound
        // onto the client object, so we pass Basic auth headers directly.
        const basic = Buffer.from(`${creds.email}:${creds.password}`, "utf8").toString("base64");
        const result = await freeBusyQuery({
          url: home,
          timeRange: { start: startISO, end: endISO },
          headers: { Authorization: `Basic ${basic}` },
        });
        return formatData(result);
      }),
  );

  // ---- create / update / delete -------------------------------------

  server.tool(
    "caldav_create_event",
    "Create a calendar event. Always emits a valid iCalendar block (UID, ORGANIZER, DTSTAMP). Does NOT email attendees — use caldav_create_event_with_invite if you want the iTIP REQUEST sent.",
    {
      calendarUrl: z.string(),
      summary: z.string(),
      startISO: z.string(),
      endISO: z.string(),
      description: z.string().optional(),
      location: z.string().optional(),
      attendees: z.array(attendeeSchema).optional(),
      rrule: z.string().optional().describe("Recurrence rule, e.g. 'FREQ=WEEKLY;BYDAY=MO'."),
    },
    async (args) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const client = await makeDavClient(creds);
        const cal = await findCalendar(client, args.calendarUrl);
        const { uid, iCalString } = buildVCalendar({
          method: args.attendees && args.attendees.length > 0 ? "REQUEST" : "PUBLISH",
          event: {
            start: new Date(args.startISO),
            end: new Date(args.endISO),
            summary: args.summary,
            description: args.description,
            location: args.location,
            organizerEmail: creds.email,
            attendees: args.attendees,
            rrule: args.rrule,
            sequence: 0,
          },
        });
        const res = await client.createCalendarObject({
          calendar: cal,
          filename: `${uid}.ics`,
          iCalString,
        });
        return formatSuccess(`event created: ${args.summary}`, {
          uid,
          status: (res as { status?: number }).status,
          url: (res as { url?: string }).url,
          location: `${uid}.ics`,
          attendeesNotified: false,
        });
      }),
  );

  server.tool(
    "caldav_create_event_with_invite",
    "Create a calendar event AND email an iTIP REQUEST to every attendee. cPanel CCS does not auto-dispatch invites, so this tool owns the wire on both sides — same UID in the calendar object and the email .ics so RSVPs match up.",
    {
      calendarUrl: z.string(),
      summary: z.string(),
      startISO: z.string(),
      endISO: z.string(),
      attendees: z.array(attendeeSchema).min(1),
      cc: z.array(z.string()).optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      rrule: z.string().optional(),
      emailSubject: z
        .string()
        .optional()
        .describe("Subject of the invite email. Defaults to 'Invitation: <summary>'."),
      emailBody: z
        .string()
        .optional()
        .describe("Plain-text body. Defaults to a one-line summary of the event."),
    },
    async (args) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const client = await makeDavClient(creds);
        const cal = await findCalendar(client, args.calendarUrl);
        const { uid, iCalString } = buildVCalendar({
          method: "REQUEST",
          event: {
            start: new Date(args.startISO),
            end: new Date(args.endISO),
            summary: args.summary,
            description: args.description,
            location: args.location,
            organizerEmail: creds.email,
            attendees: args.attendees,
            rrule: args.rrule,
            sequence: 0,
          },
        });
        const putRes = await client.createCalendarObject({
          calendar: cal,
          filename: `${uid}.ics`,
          iCalString,
        });
        // Send iMIP email to each attendee.
        const transport = nodemailer.createTransport({
          host: creds.smtpHost,
          port: creds.smtpPort,
          secure: creds.smtpSecure,
          auth: { user: creds.email, pass: creds.password },
        });
        const tos = args.attendees.map((a) => a.email);
        const info = await transport.sendMail({
          from: creds.email,
          to: tos.join(", "),
          cc: args.cc?.join(", "),
          subject: args.emailSubject ?? `Invitation: ${args.summary}`,
          text:
            args.emailBody ??
            `${args.summary}\nWhen: ${args.startISO} – ${args.endISO}${args.location ? `\nWhere: ${args.location}` : ""}${args.description ? `\n\n${args.description}` : ""}`,
          icalEvent: {
            method: "REQUEST",
            content: iCalString,
            filename: "invite.ics",
          },
        });
        return formatSuccess(`event created + invites sent`, {
          uid,
          calendarPutStatus: (putRes as { status?: number }).status,
          eventUrl: (putRes as { url?: string }).url,
          inviteMessageId: info.messageId,
          inviteAccepted: info.accepted,
          inviteRejected: info.rejected,
        });
      }),
  );

  server.tool(
    "caldav_update_event",
    "Update fields on an existing event. Etag-aware: if the server responds 412 (precondition failed) the tool refetches and merges, then retries once. Optionally emails an updated iTIP REQUEST.",
    {
      calendarUrl: z.string(),
      eventUrl: z.string(),
      summary: z.string().optional(),
      startISO: z.string().optional(),
      endISO: z.string().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      attendees: z
        .array(attendeeSchema)
        .optional()
        .describe(
          "Replace the full attendee list. Omit to leave attendees unchanged.",
        ),
      rrule: z.string().optional(),
      sendUpdate: z
        .boolean()
        .optional()
        .describe(
          "If true, also email an iTIP REQUEST (with bumped SEQUENCE) to every attendee.",
        ),
    },
    async (args) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const client = await makeDavClient(creds);
        const cal = await findCalendar(client, args.calendarUrl);
        const obj = await findEvent(client, cal, args.eventUrl);
        const parsed = parseFirstVEvent(obj.data ?? "");
        if (!parsed) throw new Error("could not parse existing event");
        const next = buildVCalendar({
          method: args.sendUpdate ? "REQUEST" : "PUBLISH",
          event: {
            uid: parsed.uid,
            start: args.startISO ? new Date(args.startISO) : (parsed.start ?? new Date()),
            end: args.endISO ? new Date(args.endISO) : (parsed.end ?? new Date()),
            summary: args.summary ?? parsed.summary ?? "",
            description: args.description ?? parsed.description ?? undefined,
            location: args.location ?? parsed.location ?? undefined,
            organizerEmail:
              parsed.organizer?.email ?? creds.email,
            organizerName: parsed.organizer?.name,
            attendees:
              args.attendees ??
              parsed.attendees.map((a) => ({
                email: a.email,
                name: a.name,
                partStat:
                  (a.partStat as AttendeePartStat | undefined) ??
                  "NEEDS-ACTION",
                rsvp: a.rsvp,
                role:
                  (a.role as
                    | "REQ-PARTICIPANT"
                    | "OPT-PARTICIPANT"
                    | "CHAIR"
                    | undefined) ?? "REQ-PARTICIPANT",
              })),
            rrule: args.rrule ?? parsed.rrule ?? undefined,
            sequence: parsed.sequence + 1,
          },
        });
        let putRes;
        try {
          putRes = await client.updateCalendarObject({
            calendarObject: { url: obj.url, etag: obj.etag, data: next.iCalString },
          });
        } catch (err) {
          // 412 retry: refetch and try once.
          const status = (err as { status?: number }).status;
          if (status !== 412) throw err;
          const fresh = await findEvent(client, cal, args.eventUrl);
          putRes = await client.updateCalendarObject({
            calendarObject: { url: fresh.url, etag: fresh.etag, data: next.iCalString },
          });
        }
        let inviteInfo: unknown = null;
        if (args.sendUpdate && (args.attendees ?? parsed.attendees).length > 0) {
          const transport = nodemailer.createTransport({
            host: creds.smtpHost,
            port: creds.smtpPort,
            secure: creds.smtpSecure,
            auth: { user: creds.email, pass: creds.password },
          });
          const tos = (args.attendees ?? parsed.attendees).map((a) => a.email);
          const info = await transport.sendMail({
            from: creds.email,
            to: tos.join(", "),
            subject: `Updated: ${args.summary ?? parsed.summary}`,
            text: `Event updated.`,
            icalEvent: {
              method: "REQUEST",
              content: next.iCalString,
              filename: "update.ics",
            },
          });
          inviteInfo = {
            messageId: info.messageId,
            accepted: info.accepted,
            rejected: info.rejected,
          };
        }
        return formatSuccess(`event updated`, {
          uid: parsed.uid,
          status: (putRes as { status?: number }).status,
          inviteInfo,
        });
      }),
  );

  server.tool(
    "caldav_delete_event",
    "Delete an event from the user's calendar. Etag-aware. Optionally dispatches an iTIP CANCEL email to the attendees before deletion.",
    {
      calendarUrl: z.string(),
      eventUrl: z.string(),
      sendCancel: z
        .boolean()
        .optional()
        .describe(
          "If true and the event has attendees, send an iTIP CANCEL email before deleting.",
        ),
      cancelReason: z.string().optional(),
    },
    async ({ calendarUrl, eventUrl, sendCancel, cancelReason }) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const client = await makeDavClient(creds);
        const cal = await findCalendar(client, calendarUrl);
        const obj = await findEvent(client, cal, eventUrl);
        const parsed = parseFirstVEvent(obj.data ?? "");
        let cancelInfo: unknown = null;
        if (sendCancel && parsed && parsed.attendees.length > 0) {
          const cancel = buildVCalendar({
            method: "CANCEL",
            event: {
              uid: parsed.uid,
              start: parsed.start ?? new Date(),
              end: parsed.end ?? new Date(),
              summary: parsed.summary ?? "Cancelled event",
              description: parsed.description ?? undefined,
              location: parsed.location ?? undefined,
              organizerEmail: parsed.organizer?.email ?? creds.email,
              organizerName: parsed.organizer?.name,
              attendees: parsed.attendees.map((a) => ({
                email: a.email,
                name: a.name,
                partStat: (a.partStat as AttendeePartStat | undefined) ?? "NEEDS-ACTION",
                role: (a.role as "REQ-PARTICIPANT" | "OPT-PARTICIPANT" | "CHAIR" | undefined) ?? "REQ-PARTICIPANT",
              })),
              sequence: parsed.sequence + 1,
              status: "CANCELLED",
            },
          });
          const transport = nodemailer.createTransport({
            host: creds.smtpHost,
            port: creds.smtpPort,
            secure: creds.smtpSecure,
            auth: { user: creds.email, pass: creds.password },
          });
          const info = await transport.sendMail({
            from: creds.email,
            to: parsed.attendees.map((a) => a.email).join(", "),
            subject: `Cancelled: ${parsed.summary ?? ""}`,
            text: cancelReason ?? "This event has been cancelled.",
            icalEvent: {
              method: "CANCEL",
              content: cancel.iCalString,
              filename: "cancel.ics",
            },
          });
          cancelInfo = {
            messageId: info.messageId,
            accepted: info.accepted,
            rejected: info.rejected,
          };
        }
        const delRes = await client.deleteCalendarObject({
          calendarObject: { url: obj.url, etag: obj.etag },
        });
        return formatSuccess(`event deleted`, {
          uid: parsed?.uid,
          status: (delRes as { status?: number }).status,
          cancelInfo,
        });
      }),
  );

  server.tool(
    "caldav_respond_to_invitation",
    "Respond to an iTIP invitation that arrived as an email attachment. Updates our PARTSTAT, writes a copy into our own calendar, and emails an iTIP REPLY back to the organizer.",
    {
      calendarUrl: z
        .string()
        .describe(
          "Calendar URL to write the accepted/tentative event into. Use caldav_list_calendars to find it.",
        ),
      iCalString: z
        .string()
        .describe(
          "The text/calendar body from the invite email (the .ics attachment).",
        ),
      partStat: z.enum(["ACCEPTED", "DECLINED", "TENTATIVE"]),
      comment: z
        .string()
        .optional()
        .describe(
          "Optional plain-text note included in the email body sent to the organizer.",
        ),
    },
    async ({ calendarUrl, iCalString, partStat, comment }) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const parsed = parseFirstVEvent(iCalString);
        if (!parsed) throw new Error("could not parse the invitation iCalendar");
        if (!parsed.organizer?.email) {
          throw new Error("invitation has no ORGANIZER — cannot send REPLY");
        }
        const client = await makeDavClient(creds);
        const cal = await findCalendar(client, calendarUrl);
        // Persist a copy into our own calendar with our PARTSTAT updated, but
        // only if we accepted/tentatively accepted.
        if (partStat !== "DECLINED") {
          const local = buildVCalendar({
            method: "PUBLISH",
            event: {
              uid: parsed.uid,
              start: parsed.start ?? new Date(),
              end: parsed.end ?? new Date(),
              summary: parsed.summary ?? "",
              description: parsed.description ?? undefined,
              location: parsed.location ?? undefined,
              organizerEmail: parsed.organizer.email,
              organizerName: parsed.organizer.name,
              attendees: parsed.attendees.map((a) =>
                a.email.toLowerCase() === creds.email.toLowerCase()
                  ? {
                      email: a.email,
                      name: a.name,
                      partStat,
                      rsvp: false,
                      role: (a.role as "REQ-PARTICIPANT" | "OPT-PARTICIPANT" | "CHAIR" | undefined) ?? "REQ-PARTICIPANT",
                    }
                  : {
                      email: a.email,
                      name: a.name,
                      partStat: (a.partStat as AttendeePartStat | undefined) ?? "NEEDS-ACTION",
                      role: (a.role as "REQ-PARTICIPANT" | "OPT-PARTICIPANT" | "CHAIR" | undefined) ?? "REQ-PARTICIPANT",
                    },
              ),
              sequence: parsed.sequence,
            },
          });
          await client.createCalendarObject({
            calendar: cal,
            filename: `${parsed.uid}.ics`,
            iCalString: local.iCalString,
          });
        }
        // Build a REPLY containing only our ATTENDEE line + the organizer.
        const reply = buildVCalendar({
          method: "REPLY",
          event: {
            uid: parsed.uid,
            start: parsed.start ?? new Date(),
            end: parsed.end ?? new Date(),
            summary: parsed.summary ?? "",
            organizerEmail: parsed.organizer.email,
            organizerName: parsed.organizer.name,
            attendees: [
              {
                email: creds.email,
                partStat,
                rsvp: false,
                role: "REQ-PARTICIPANT",
              },
            ],
            sequence: parsed.sequence,
          },
        });
        const transport = nodemailer.createTransport({
          host: creds.smtpHost,
          port: creds.smtpPort,
          secure: creds.smtpSecure,
          auth: { user: creds.email, pass: creds.password },
        });
        const info = await transport.sendMail({
          from: creds.email,
          to: parsed.organizer.email,
          subject: `${partStat === "ACCEPTED" ? "Accepted" : partStat === "DECLINED" ? "Declined" : "Tentative"}: ${parsed.summary ?? ""}`,
          text: comment ?? `Your invitation has been ${partStat.toLowerCase()}.`,
          icalEvent: {
            method: "REPLY",
            content: reply.iCalString,
            filename: "reply.ics",
          },
        });
        return formatSuccess(`replied ${partStat} to ${parsed.organizer.email}`, {
          uid: parsed.uid,
          messageId: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected,
        });
      }),
  );
}
