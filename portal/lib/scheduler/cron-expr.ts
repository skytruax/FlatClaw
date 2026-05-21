/**
 * Friendly-frequency ⇄ openclaw CronSchedule conversion + plain-language
 * descriptions. Isomorphic — no Node-only imports, so client components
 * (the composer's preview line) and API routes share this module.
 *
 * openclaw's `CronSchedule` is a discriminated union of three kinds:
 *   { kind: "at",    at: ISO8601 }                      — one-shot
 *   { kind: "every", everyMs, anchorMs? }               — fixed interval
 *   { kind: "cron",  expr: "<5-field>", tz?, staggerMs? }
 *
 * The portal's frequency picker is a friendlier surface over those. This file
 * is the only place that knows how to generate a cron expr from picker state
 * and how to read one back for the edit form / list view.
 */

// ───────────────────────────── shared types ─────────────────────────────

/** Mirror of openclaw's CronSchedule union (re-declared so we don't import openclaw source). */
export type CronScheduleDTO =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string; staggerMs?: number };

export type FrequencyKind =
  | "once"
  | "daily"
  | "weekly"
  | "monthly"
  | "every"
  | "custom";

export type EveryUnit = "minutes" | "hours";

/** Picker state. `hour` is 0-23, `minute` 0-59. `days` use 0=Sun … 6=Sat. */
export type FrequencyInput =
  | { kind: "once"; at: string /* absolute ISO 8601 */ }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; days: number[]; hour: number; minute: number }
  | { kind: "monthly"; day: number /* 1-31 */; hour: number; minute: number }
  | { kind: "every"; n: number; unit: EveryUnit }
  | { kind: "custom"; expr: string };

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAY_LABELS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

// ───────────────────────────── time helpers ─────────────────────────────

export function clampHour(h: number): number {
  return Math.max(0, Math.min(23, Math.floor(h)));
}
export function clampMinute(m: number): number {
  return Math.max(0, Math.min(59, Math.floor(m)));
}
export function clampDom(d: number): number {
  return Math.max(1, Math.min(31, Math.floor(d)));
}

/** "9:00 AM", "12:30 PM", "11:05 PM" from 24h hour+minute. */
export function formatTime12(hour: number, minute: number): string {
  const h = clampHour(hour);
  const m = clampMinute(minute);
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ──────────────────────── friendly → CronSchedule ───────────────────────

export class ScheduleBuildError extends Error {}

/**
 * Build the openclaw CronSchedule from picker state. `tz` is the IANA
 * timezone string used for `cron`-kind schedules; `at` (one-shot) schedules
 * carry an absolute timestamp so no tz is needed there.
 */
export function buildSchedule(input: FrequencyInput, tz: string): CronScheduleDTO {
  switch (input.kind) {
    case "once": {
      const t = new Date(input.at);
      if (Number.isNaN(t.getTime())) {
        throw new ScheduleBuildError("Pick a valid date and time.");
      }
      return { kind: "at", at: t.toISOString() };
    }
    case "every": {
      const n = Math.floor(input.n);
      if (!Number.isFinite(n) || n < 1) {
        throw new ScheduleBuildError("Interval must be a positive number.");
      }
      const everyMs = n * (input.unit === "hours" ? HOUR_MS : MINUTE_MS);
      return { kind: "every", everyMs };
    }
    case "daily": {
      const expr = `${clampMinute(input.minute)} ${clampHour(input.hour)} * * *`;
      return { kind: "cron", expr, tz };
    }
    case "weekly": {
      const days = normalizeDays(input.days);
      if (days.length === 0) {
        throw new ScheduleBuildError("Pick at least one day of the week.");
      }
      const dow = days.length === 7 ? "*" : days.join(",");
      const expr = `${clampMinute(input.minute)} ${clampHour(input.hour)} * * ${dow}`;
      return { kind: "cron", expr, tz };
    }
    case "monthly": {
      const expr = `${clampMinute(input.minute)} ${clampHour(input.hour)} ${clampDom(input.day)} * *`;
      return { kind: "cron", expr, tz };
    }
    case "custom": {
      const v = validateCronExpr(input.expr);
      if (!v.ok) throw new ScheduleBuildError(v.error);
      return { kind: "cron", expr: input.expr.trim().replace(/\s+/g, " "), tz };
    }
  }
}

export function isOneOff(input: FrequencyInput): boolean {
  return input.kind === "once";
}

function normalizeDays(days: number[]): number[] {
  const set = new Set<number>();
  for (const d of days) {
    const v = Math.floor(d);
    if (v === 7) set.add(0);
    else if (v >= 0 && v <= 6) set.add(v);
  }
  return [...set].sort((a, b) => a - b);
}

// ──────────────────────── CronSchedule → friendly ───────────────────────

/**
 * Best-effort reverse: map a CronSchedule back to picker state for the edit
 * form. Returns `{ kind: "custom" }` for any cron expr we didn't generate
 * ourselves (the form falls back to the raw-expr text field).
 */
export function frequencyFromSchedule(schedule: CronScheduleDTO): FrequencyInput {
  if (schedule.kind === "at") return { kind: "once", at: schedule.at };
  if (schedule.kind === "every") {
    const ms = schedule.everyMs;
    if (ms % HOUR_MS === 0) return { kind: "every", n: ms / HOUR_MS, unit: "hours" };
    return { kind: "every", n: Math.max(1, Math.round(ms / MINUTE_MS)), unit: "minutes" };
  }
  // kind === "cron"
  const parsed = parseSimpleCron(schedule.expr);
  if (!parsed) return { kind: "custom", expr: schedule.expr };
  const { minute, hour, dom, dow } = parsed;
  if (dom !== "*" && dow === "*") {
    const d = Number(dom);
    if (Number.isInteger(d) && d >= 1 && d <= 31) {
      return { kind: "monthly", day: d, hour, minute };
    }
    return { kind: "custom", expr: schedule.expr };
  }
  if (dom === "*" && dow !== "*") {
    const days = parseDowList(dow);
    if (days) return { kind: "weekly", days, hour, minute };
    return { kind: "custom", expr: schedule.expr };
  }
  if (dom === "*" && dow === "*") return { kind: "daily", hour, minute };
  return { kind: "custom", expr: schedule.expr };
}

interface SimpleCron {
  minute: number;
  hour: number;
  dom: string;
  month: string;
  dow: string;
}

/** Parse a 5-field expr where minute+hour are plain integers. Returns null otherwise. */
function parseSimpleCron(expr: string): SimpleCron | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, month, dow] = parts;
  const mi = Number(m);
  const hi = Number(h);
  if (!Number.isInteger(mi) || mi < 0 || mi > 59) return null;
  if (!Number.isInteger(hi) || hi < 0 || hi > 23) return null;
  if (month !== "*") return null;
  return { minute: mi, hour: hi, dom, month, dow };
}

/** "1,3,5" → [1,3,5]; "1-5" → [1,2,3,4,5]; "*" → null; bad input → null. */
function parseDowList(field: string): number[] | null {
  if (field === "*") return null;
  const out = new Set<number>();
  for (const chunk of field.split(",")) {
    const range = chunk.match(/^(\d+)-(\d+)$/);
    if (range) {
      let a = Number(range[1]);
      let b = Number(range[2]);
      if (a > 7 || b > 7) return null;
      a = a === 7 ? 0 : a;
      b = b === 7 ? 0 : b;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let i = lo; i <= hi; i++) out.add(i);
    } else if (/^\d+$/.test(chunk)) {
      let v = Number(chunk);
      if (v > 7) return null;
      v = v === 7 ? 0 : v;
      out.add(v);
    } else {
      return null;
    }
  }
  return [...out].sort((a, b) => a - b);
}

// ─────────────────────── plain-language descriptions ────────────────────

function describeDays(days: number[]): string {
  const d = normalizeDays(days);
  if (d.length === 7) return "every day";
  if (d.length === 5 && [1, 2, 3, 4, 5].every((x) => d.includes(x))) return "every weekday";
  if (d.length === 2 && d.includes(0) && d.includes(6)) return "weekends";
  if (d.length === 1) return `every ${WEEKDAY_LABELS_LONG[d[0]]}`;
  return d.map((x) => WEEKDAY_LABELS[x]).join(", ");
}

/** Plain-English summary of a CronSchedule, e.g. "Every weekday at 8:30 AM (America/New_York)". */
export function describeSchedule(schedule: CronScheduleDTO): string {
  if (schedule.kind === "at") {
    const t = new Date(schedule.at);
    if (Number.isNaN(t.getTime())) return `Once · ${schedule.at}`;
    return `Once · ${t.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }
  if (schedule.kind === "every") {
    const ms = schedule.everyMs;
    if (ms % HOUR_MS === 0) {
      const n = ms / HOUR_MS;
      return n === 1 ? "Every hour" : `Every ${n} hours`;
    }
    const n = Math.max(1, Math.round(ms / MINUTE_MS));
    return n === 1 ? "Every minute" : `Every ${n} minutes`;
  }
  // cron
  const tzSuffix = schedule.tz ? ` (${schedule.tz})` : "";
  const parsed = parseSimpleCron(schedule.expr);
  if (!parsed) return `Custom: ${schedule.expr}${tzSuffix}`;
  const time = formatTime12(parsed.hour, parsed.minute);
  if (parsed.dom !== "*" && parsed.dow === "*") {
    const d = Number(parsed.dom);
    if (Number.isInteger(d)) return `On the ${ordinal(d)} of every month at ${time}${tzSuffix}`;
  }
  if (parsed.dom === "*" && parsed.dow !== "*") {
    const days = parseDowList(parsed.dow);
    if (days) {
      const phrase = describeDays(days);
      const lead = phrase.startsWith("every") || phrase === "weekends" ? "" : "every ";
      return `${capitalize(lead + phrase)} at ${time}${tzSuffix}`;
    }
  }
  if (parsed.dom === "*" && parsed.dow === "*") return `Every day at ${time}${tzSuffix}`;
  return `Custom: ${schedule.expr}${tzSuffix}`;
}

/** Summary straight from picker state — used for the live preview line in the composer. */
export function describeFrequencyInput(input: FrequencyInput, tz: string): string {
  try {
    return describeSchedule(buildSchedule(input, tz));
  } catch (err) {
    return err instanceof Error ? err.message : "Incomplete schedule";
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

// ───────────────────────────── validation ──────────────────────────────

const FIELD_RE = /^[\d*/,\-LW#?]+$/;

/**
 * Lenient client/server validation of a 5-field cron expr. Confirms shape
 * only (5 non-empty tokens, allowed characters) — openclaw's parser is the
 * final authority and `cron.add` will reject anything it can't handle.
 */
export function validateCronExpr(expr: string): { ok: true } | { ok: false; error: string } {
  const trimmed = (expr ?? "").trim();
  if (!trimmed) return { ok: false, error: "Enter a cron expression (5 fields)." };
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return {
      ok: false,
      error: `Expected 5 space-separated fields (min hour day month weekday), got ${parts.length}.`,
    };
  }
  for (let i = 0; i < parts.length; i++) {
    if (!FIELD_RE.test(parts[i])) {
      return { ok: false, error: `Field ${i + 1} ("${parts[i]}") has unsupported characters.` };
    }
  }
  return { ok: true };
}
