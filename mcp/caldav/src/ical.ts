/**
 * Shared iCalendar building + parsing for the CalDav MCP.
 *
 * The original CalDav tool built a minimal VEVENT inline and skipped
 * ORGANIZER + ATTENDEE entirely, so events created through the agent
 * never delivered iTIP invites — that's the reason `caldav_create_event`
 * "succeeded" without notifying the attendee. Every VEVENT now goes
 * through `buildVCalendar` so attendee/organizer/method are consistent.
 *
 * RFC refs: 5545 (iCalendar core), 6047 (iMIP), 6638 (CalDAV scheduling),
 * 6352 (CardDAV / vCard 3.0).
 */
import { randomUUID } from "node:crypto";

export type ICalMethod = "REQUEST" | "CANCEL" | "REPLY" | "PUBLISH";
export type AttendeePartStat =
  | "NEEDS-ACTION"
  | "ACCEPTED"
  | "DECLINED"
  | "TENTATIVE"
  | "DELEGATED";

export interface BuildAttendee {
  email: string;
  name?: string;
  partStat?: AttendeePartStat;
  /** Whether to ask the attendee to RSVP. Defaults true for REQUEST. */
  rsvp?: boolean;
  /** REQ-PARTICIPANT (default) | OPT-PARTICIPANT | CHAIR */
  role?: "REQ-PARTICIPANT" | "OPT-PARTICIPANT" | "CHAIR";
}

export interface BuildVEventArgs {
  uid?: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
  organizerEmail: string;
  organizerName?: string;
  attendees?: BuildAttendee[];
  /** RFC 5545 SEQUENCE — bumped on every UPDATE or CANCEL of an existing event. */
  sequence?: number;
  /** STATUS line. Defaults to CONFIRMED unless method is CANCEL (then CANCELLED). */
  status?: "CONFIRMED" | "CANCELLED" | "TENTATIVE";
  /** Recurrence rule, e.g. "FREQ=WEEKLY;BYDAY=MO". */
  rrule?: string;
}

/** RFC 5545 `YYYYMMDDTHHMMSSZ` UTC form. */
export function toICalUtc(d: Date): string {
  const z = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    String(d.getUTCFullYear()) +
    z(d.getUTCMonth() + 1) +
    z(d.getUTCDate()) +
    "T" +
    z(d.getUTCHours()) +
    z(d.getUTCMinutes()) +
    z(d.getUTCSeconds()) +
    "Z"
  );
}

/** RFC 5545 §3.3.11 escape rules for TEXT values. */
export function escapeICalText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Cap each line at 75 octets per RFC 5545 §3.1; continuations begin with a space. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let buf = line;
  parts.push(buf.slice(0, 75));
  buf = buf.slice(75);
  while (buf.length > 0) {
    parts.push(" " + buf.slice(0, 74));
    buf = buf.slice(74);
  }
  return parts.join("\r\n");
}

function attendeeLine(a: BuildAttendee): string {
  const parts = ["ATTENDEE"];
  parts.push(`ROLE=${a.role ?? "REQ-PARTICIPANT"}`);
  parts.push(`PARTSTAT=${a.partStat ?? "NEEDS-ACTION"}`);
  parts.push(`RSVP=${a.rsvp === false ? "FALSE" : "TRUE"}`);
  if (a.name) parts.push(`CN=${escapeICalText(a.name)}`);
  return foldLine(`${parts.join(";")}:mailto:${a.email}`);
}

function organizerLine(email: string, name?: string): string {
  if (!name) return `ORGANIZER:mailto:${email}`;
  return foldLine(`ORGANIZER;CN=${escapeICalText(name)}:mailto:${email}`);
}

export interface BuildResult {
  uid: string;
  iCalString: string;
}

export function buildVCalendar(args: {
  method?: ICalMethod;
  event: BuildVEventArgs;
}): BuildResult {
  const e = args.event;
  const uid = e.uid ?? `${randomUUID()}@flatclaw.org`;
  const dtstamp = toICalUtc(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FlatClaw//CalDav MCP//EN",
    "CALSCALE:GREGORIAN",
  ];
  if (args.method) lines.push(`METHOD:${args.method}`);
  lines.push(
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${toICalUtc(e.start)}`,
    `DTEND:${toICalUtc(e.end)}`,
    foldLine(`SUMMARY:${escapeICalText(e.summary)}`),
  );
  if (e.description)
    lines.push(foldLine(`DESCRIPTION:${escapeICalText(e.description)}`));
  if (e.location) lines.push(foldLine(`LOCATION:${escapeICalText(e.location)}`));
  if (e.rrule) lines.push(`RRULE:${e.rrule}`);
  if (typeof e.sequence === "number") lines.push(`SEQUENCE:${e.sequence}`);
  const status =
    e.status ?? (args.method === "CANCEL" ? "CANCELLED" : "CONFIRMED");
  lines.push(`STATUS:${status}`);
  lines.push(organizerLine(e.organizerEmail, e.organizerName));
  for (const a of e.attendees ?? []) lines.push(attendeeLine(a));
  lines.push("END:VEVENT", "END:VCALENDAR");
  return { uid, iCalString: lines.join("\r\n") + "\r\n" };
}

/**
 * Minimal-shape parsed VEVENT — fields the MCP commonly needs back from
 * round-tripping through node-ical. node-ical's own types are loose so we
 * normalize here.
 */
export interface ParsedEvent {
  uid: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  start: Date | null;
  end: Date | null;
  sequence: number;
  status: string | null;
  organizer: { email: string; name?: string } | null;
  attendees: Array<{
    email: string;
    name?: string;
    partStat?: string;
    role?: string;
    rsvp?: boolean;
  }>;
  rrule: string | null;
  rawICal: string;
}

interface NodeIcalAttendee {
  val?: string;
  params?: Record<string, string>;
}

interface NodeIcalEvent {
  type?: string;
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: Date;
  end?: Date;
  sequence?: string | number;
  status?: string;
  organizer?: NodeIcalAttendee | string;
  attendee?: NodeIcalAttendee | NodeIcalAttendee[];
  rrule?: { toString(): string };
}

function normalizeAttendee(a: NodeIcalAttendee | string): {
  email: string;
  name?: string;
  partStat?: string;
  role?: string;
  rsvp?: boolean;
} {
  if (typeof a === "string") {
    return { email: a.replace(/^mailto:/i, "") };
  }
  const email = (a.val ?? "").replace(/^mailto:/i, "");
  const params = a.params ?? {};
  return {
    email,
    name: params.CN,
    partStat: params.PARTSTAT,
    role: params.ROLE,
    rsvp: params.RSVP ? params.RSVP.toUpperCase() === "TRUE" : undefined,
  };
}

/** Parse one VCALENDAR string into the first VEVENT it contains. */
export function parseFirstVEvent(iCalString: string): ParsedEvent | null {
  // Lazy require so the dep is only loaded when needed (it's not the
  // hottest path).
  const ical = require("node-ical") as {
    parseICS: (s: string) => Record<string, NodeIcalEvent>;
  };
  const parsed = ical.parseICS(iCalString);
  for (const key of Object.keys(parsed)) {
    const v = parsed[key];
    if (v?.type !== "VEVENT") continue;
    const attendeesRaw = v.attendee
      ? Array.isArray(v.attendee)
        ? v.attendee
        : [v.attendee]
      : [];
    return {
      uid: v.uid ?? key,
      summary: v.summary ?? null,
      description: v.description ?? null,
      location: v.location ?? null,
      start: v.start ?? null,
      end: v.end ?? null,
      sequence:
        typeof v.sequence === "number"
          ? v.sequence
          : v.sequence
            ? Number(v.sequence) || 0
            : 0,
      status: v.status ?? null,
      organizer: v.organizer ? normalizeAttendee(v.organizer) : null,
      attendees: attendeesRaw.map(normalizeAttendee),
      rrule: v.rrule?.toString() ?? null,
      rawICal: iCalString,
    };
  }
  return null;
}

/**
 * Build a vCard 3.0 (RFC 6352 / RFC 2426). Minimal shape — matches what
 * cPanel CCS / Apple Contacts / Thunderbird all accept.
 */
export interface BuildVCardArgs {
  uid?: string;
  fullName: string;
  /** "Last;First" form. Auto-derived from fullName if omitted. */
  structuredName?: string;
  emails?: Array<{ value: string; type?: "INTERNET" | "WORK" | "HOME" }>;
  phones?: Array<{ value: string; type?: "CELL" | "WORK" | "HOME" | "FAX" }>;
  org?: string;
  title?: string;
  notes?: string;
}

export function buildVCard(args: BuildVCardArgs): { uid: string; vCard: string } {
  const uid = args.uid ?? `${randomUUID()}@flatclaw.org`;
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0", `UID:${uid}`];
  lines.push(foldLine(`FN:${escapeICalText(args.fullName)}`));
  let n = args.structuredName;
  if (!n) {
    const parts = args.fullName.split(/\s+/);
    if (parts.length > 1) n = `${parts.slice(-1).join(" ")};${parts.slice(0, -1).join(" ")};;;`;
    else n = `${args.fullName};;;;`;
  }
  lines.push(foldLine(`N:${n}`));
  for (const e of args.emails ?? []) {
    const type = e.type ?? "INTERNET";
    lines.push(foldLine(`EMAIL;TYPE=${type}:${e.value}`));
  }
  for (const p of args.phones ?? []) {
    const type = p.type ?? "CELL";
    lines.push(foldLine(`TEL;TYPE=${type}:${p.value}`));
  }
  if (args.org) lines.push(foldLine(`ORG:${escapeICalText(args.org)}`));
  if (args.title) lines.push(foldLine(`TITLE:${escapeICalText(args.title)}`));
  if (args.notes) lines.push(foldLine(`NOTE:${escapeICalText(args.notes)}`));
  lines.push("END:VCARD");
  return { uid, vCard: lines.join("\r\n") + "\r\n" };
}
