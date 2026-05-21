import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GoogleApiClient } from "../google-client.js";
import { handleToolCall, formatData, formatSuccess } from "../tool-helpers.js";

const CAL = "https://www.googleapis.com/calendar/v3";

const attendeeSchema = z.object({
  email: z.string(),
  displayName: z.string().optional(),
  optional: z.boolean().optional(),
  responseStatus: z
    .enum(["needsAction", "accepted", "declined", "tentative"])
    .optional(),
});

export function registerCalendarTools(server: McpServer, api: GoogleApiClient): void {
  server.tool(
    "calendar_list_calendars",
    "List the user's calendars (calendar list entries).",
    {},
    async () =>
      handleToolCall(async () => {
        const r = await api.request<{ items?: unknown[] }>(
          `${CAL}/users/me/calendarList`,
        );
        return formatData(r.items ?? []);
      }),
  );

  server.tool(
    "calendar_events",
    "List events in a calendar within a time range. Default: primary calendar, today through 7 days ahead. If you omit `time_min_iso`/`time_max_iso` the server uses 'now' from the host's clock — no need to compute the date yourself. For specific windows (\"next week\", \"this month\"), call `exec` with `node -e \"console.log(new Date().toISOString())\"` first to read the actual current time.",
    {
      calendar_id: z
        .string()
        .optional()
        .describe("Calendar id, defaults to 'primary'."),
      time_min_iso: z.string().optional().describe("RFC3339 start; default now."),
      time_max_iso: z
        .string()
        .optional()
        .describe("RFC3339 end; default now+7d."),
      q: z.string().optional().describe("Free-text search across event fields."),
      max: z.number().int().min(1).max(2500).optional(),
      single_events: z
        .boolean()
        .optional()
        .describe(
          "Expand recurring events into instances. Default true (matches what humans expect from 'list events').",
        ),
    },
    async ({ calendar_id, time_min_iso, time_max_iso, q, max, single_events }) =>
      handleToolCall(async () => {
        const now = new Date();
        const r = await api.request<{ items?: unknown[] }>(
          `${CAL}/calendars/${encodeURIComponent(calendar_id ?? "primary")}/events`,
          {
            query: {
              timeMin: time_min_iso ?? now.toISOString(),
              timeMax:
                time_max_iso ??
                new Date(now.getTime() + 7 * 86400_000).toISOString(),
              q,
              maxResults: max ?? 100,
              singleEvents: single_events ?? true,
              orderBy: (single_events ?? true) ? "startTime" : undefined,
            },
          },
        );
        return formatData(r.items ?? []);
      }),
  );

  server.tool(
    "calendar_get_event",
    "Get a single calendar event by id.",
    {
      calendar_id: z.string().optional(),
      event_id: z.string(),
    },
    async ({ calendar_id, event_id }) =>
      handleToolCall(async () => {
        const r = await api.request(
          `${CAL}/calendars/${encodeURIComponent(calendar_id ?? "primary")}/events/${encodeURIComponent(event_id)}`,
        );
        return formatData(r);
      }),
  );

  server.tool(
    "calendar_create_event",
    "Create a calendar event. If `attendees` is non-empty AND `send_invites` is true (the default), Google emails iTIP REQUEST to every attendee on our behalf — no separate SMTP send needed. **Important: do not assume the current date.** For relative times (\"tomorrow at 9am\", \"next Tuesday\") first call `exec` with `node -e \"console.log(new Date().toISOString())\"` to read the host clock, then compute the target time, then pass an absolute RFC3339 string to `start_iso`/`end_iso`.",
    {
      calendar_id: z.string().optional(),
      summary: z.string(),
      description: z.string().optional(),
      location: z.string().optional(),
      start_iso: z
        .string()
        .describe(
          "Start time. RFC3339 (e.g. '2026-05-07T09:00:00-04:00') for timed events, or 'YYYY-MM-DD' for all-day.",
        ),
      end_iso: z.string(),
      timezone: z
        .string()
        .optional()
        .describe("IANA timezone for start/end (e.g. 'America/New_York')."),
      all_day: z.boolean().optional(),
      attendees: z.array(attendeeSchema).optional(),
      send_invites: z
        .boolean()
        .optional()
        .describe("Default true. Google dispatches iTIP REQUEST to attendees."),
      recurrence: z
        .array(z.string())
        .optional()
        .describe("RRULE strings, e.g. ['RRULE:FREQ=WEEKLY;BYDAY=MO']."),
      conference_data: z
        .boolean()
        .optional()
        .describe(
          "If true, Google generates a Meet link for the event (sets conferenceDataVersion=1).",
        ),
    },
    async (args) =>
      handleToolCall(async () => {
        const start = args.all_day
          ? { date: args.start_iso, timeZone: args.timezone }
          : { dateTime: args.start_iso, timeZone: args.timezone };
        const end = args.all_day
          ? { date: args.end_iso, timeZone: args.timezone }
          : { dateTime: args.end_iso, timeZone: args.timezone };
        const event: Record<string, unknown> = {
          summary: args.summary,
          description: args.description,
          location: args.location,
          start,
          end,
        };
        if (args.attendees?.length) event.attendees = args.attendees;
        if (args.recurrence?.length) event.recurrence = args.recurrence;
        if (args.conference_data) {
          event.conferenceData = {
            createRequest: {
              requestId: `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          };
        }
        const sendUpdates =
          args.attendees?.length && args.send_invites !== false ? "all" : "none";
        const result = await api.request(
          `${CAL}/calendars/${encodeURIComponent(args.calendar_id ?? "primary")}/events`,
          {
            method: "POST",
            query: {
              sendUpdates,
              conferenceDataVersion: args.conference_data ? 1 : undefined,
            },
            json: event,
          },
        );
        return formatSuccess(
          args.attendees?.length && args.send_invites !== false
            ? `event created + invites dispatched to ${args.attendees.length} attendee(s)`
            : `event created`,
          result,
        );
      }),
  );

  server.tool(
    "calendar_update_event",
    "Update a calendar event (PATCH). Only the supplied fields change. If attendees change and `send_updates` is 'all' (default when attendees touched), Google emails the iTIP UPDATE.",
    {
      calendar_id: z.string().optional(),
      event_id: z.string(),
      summary: z.string().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      start_iso: z.string().optional(),
      end_iso: z.string().optional(),
      timezone: z.string().optional(),
      all_day: z.boolean().optional(),
      attendees: z.array(attendeeSchema).optional(),
      send_updates: z.enum(["all", "externalOnly", "none"]).optional(),
    },
    async (args) =>
      handleToolCall(async () => {
        const patch: Record<string, unknown> = {};
        if (args.summary !== undefined) patch.summary = args.summary;
        if (args.description !== undefined) patch.description = args.description;
        if (args.location !== undefined) patch.location = args.location;
        if (args.start_iso) {
          patch.start = args.all_day
            ? { date: args.start_iso, timeZone: args.timezone }
            : { dateTime: args.start_iso, timeZone: args.timezone };
        }
        if (args.end_iso) {
          patch.end = args.all_day
            ? { date: args.end_iso, timeZone: args.timezone }
            : { dateTime: args.end_iso, timeZone: args.timezone };
        }
        if (args.attendees) patch.attendees = args.attendees;
        const sendUpdates =
          args.send_updates ??
          (args.attendees ? "all" : "none");
        const result = await api.request(
          `${CAL}/calendars/${encodeURIComponent(args.calendar_id ?? "primary")}/events/${encodeURIComponent(args.event_id)}`,
          {
            method: "PATCH",
            query: { sendUpdates },
            json: patch,
          },
        );
        return formatSuccess(`event updated`, result);
      }),
  );

  server.tool(
    "calendar_delete_event",
    "Delete (cancel) a calendar event. If the event has attendees, `send_updates: 'all'` (default) emails iTIP CANCEL to them.",
    {
      calendar_id: z.string().optional(),
      event_id: z.string(),
      send_updates: z.enum(["all", "externalOnly", "none"]).optional(),
    },
    async ({ calendar_id, event_id, send_updates }) =>
      handleToolCall(async () => {
        await api.request(
          `${CAL}/calendars/${encodeURIComponent(calendar_id ?? "primary")}/events/${encodeURIComponent(event_id)}`,
          {
            method: "DELETE",
            query: { sendUpdates: send_updates ?? "all" },
          },
        );
        return formatSuccess(`event ${event_id} cancelled`);
      }),
  );

  server.tool(
    "calendar_respond",
    "Update the user's responseStatus on an event they were invited to (accept / decline / tentative). Google routes the iTIP REPLY back to the organizer.",
    {
      calendar_id: z.string().optional(),
      event_id: z.string(),
      response: z.enum(["accepted", "declined", "tentative"]),
      comment: z.string().optional(),
    },
    async ({ calendar_id, event_id, response, comment }) =>
      handleToolCall(async () => {
        const myEmail = api.identityHint();
        if (!myEmail) throw new Error("identity not yet established; call any other tool first");
        const cur = await api.request<{
          attendees?: Array<{ email?: string; self?: boolean; responseStatus?: string; comment?: string }>;
        }>(
          `${CAL}/calendars/${encodeURIComponent(calendar_id ?? "primary")}/events/${encodeURIComponent(event_id)}`,
        );
        const attendees = (cur.attendees ?? []).map((a) =>
          a.self || (a.email && a.email.toLowerCase() === myEmail.toLowerCase())
            ? { ...a, responseStatus: response, comment: comment ?? a.comment }
            : a,
        );
        // If we weren't on the attendee list at all (rare — e.g. responding to
        // a forwarded invite), add ourselves.
        if (!attendees.some((a) => a.email?.toLowerCase() === myEmail.toLowerCase() || a.self)) {
          attendees.push({ email: myEmail, responseStatus: response, comment });
        }
        const result = await api.request(
          `${CAL}/calendars/${encodeURIComponent(calendar_id ?? "primary")}/events/${encodeURIComponent(event_id)}`,
          {
            method: "PATCH",
            query: { sendUpdates: "all" },
            json: { attendees },
          },
        );
        return formatSuccess(`responded ${response}`, result);
      }),
  );

  server.tool(
    "calendar_freebusy",
    "Query free/busy time for one or more calendars within a window.",
    {
      calendar_ids: z
        .array(z.string())
        .optional()
        .describe("Calendar ids; default ['primary']."),
      time_min_iso: z.string(),
      time_max_iso: z.string(),
      timezone: z.string().optional(),
    },
    async ({ calendar_ids, time_min_iso, time_max_iso, timezone }) =>
      handleToolCall(async () => {
        const r = await api.request(`${CAL}/freeBusy`, {
          method: "POST",
          json: {
            timeMin: time_min_iso,
            timeMax: time_max_iso,
            timeZone: timezone,
            items: (calendar_ids ?? ["primary"]).map((id) => ({ id })),
          },
        });
        return formatData(r);
      }),
  );
}
