"use client";

import {
  WEEKDAY_LABELS,
  clampDom,
  validateCronExpr,
  type EveryUnit,
  type FrequencyInput,
  type FrequencyKind,
} from "@/lib/scheduler/cron-expr";

/**
 * The Once / Daily / Weekly / Monthly / Every-N / Custom frequency picker,
 * with conditional sub-forms. Modeled on Google Calendar's recurrence
 * editor — the caller renders the plain-language preview line beneath it.
 */
export default function FrequencyPicker({
  value,
  onChange,
  timezone,
}: {
  value: FrequencyInput;
  onChange: (next: FrequencyInput) => void;
  timezone: string;
}) {
  function setKind(kind: FrequencyKind) {
    if (kind === value.kind) return;
    onChange(defaultForKind(kind));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {(
          [
            ["once", "Once"],
            ["daily", "Daily"],
            ["weekly", "Weekly"],
            ["monthly", "Monthly"],
            ["every", "Every…"],
            ["custom", "Custom (cron)"],
          ] as [FrequencyKind, string][]
        ).map(([k, label]) => (
          <label key={k} className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="frequency-kind"
              checked={value.kind === k}
              onChange={() => setKind(k)}
              className="accent-[hsl(var(--brand-accent))]"
            />
            <span>{label}</span>
          </label>
        ))}
      </div>

      <div className="rounded border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-soft))] p-3 text-sm">
        {value.kind === "once" && <OnceForm value={value} onChange={onChange} timezone={timezone} />}
        {value.kind === "daily" && <TimeRow hour={value.hour} minute={value.minute} timezone={timezone} onChange={(h, m) => onChange({ kind: "daily", hour: h, minute: m })} />}
        {value.kind === "weekly" && <WeeklyForm value={value} onChange={onChange} timezone={timezone} />}
        {value.kind === "monthly" && <MonthlyForm value={value} onChange={onChange} timezone={timezone} />}
        {value.kind === "every" && <EveryForm value={value} onChange={onChange} />}
        {value.kind === "custom" && <CustomForm value={value} onChange={onChange} />}
      </div>
    </div>
  );
}

// ─────────────────────────────── defaults ───────────────────────────────

export function defaultForKind(kind: FrequencyKind): FrequencyInput {
  switch (kind) {
    case "once": {
      // Default: tomorrow at 09:00 local.
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return { kind: "once", at: d.toISOString() };
    }
    case "daily":
      return { kind: "daily", hour: 9, minute: 0 };
    case "weekly":
      return { kind: "weekly", days: [1], hour: 9, minute: 0 };
    case "monthly":
      return { kind: "monthly", day: 1, hour: 6, minute: 0 };
    case "every":
      return { kind: "every", n: 2, unit: "hours" };
    case "custom":
      return { kind: "custom", expr: "0 9 * * 1-5" };
  }
}

// ──────────────────────────── datetime-local ────────────────────────────

function toLocalDatetimeInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toTimeInputValue(hour: number, minute: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hour)}:${pad(minute)}`;
}

function parseTimeInput(v: string): { hour: number; minute: number } {
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { hour: 9, minute: 0 };
  return {
    hour: Math.max(0, Math.min(23, Number(m[1]))),
    minute: Math.max(0, Math.min(59, Number(m[2]))),
  };
}

// ───────────────────────────── sub-forms ────────────────────────────────

function OnceForm({
  value,
  onChange,
  timezone,
}: {
  value: Extract<FrequencyInput, { kind: "once" }>;
  onChange: (v: FrequencyInput) => void;
  timezone: string;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-[hsl(var(--fc-fg-secondary))]">Run at</span>
      <input
        type="datetime-local"
        value={toLocalDatetimeInputValue(value.at)}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          const d = new Date(v);
          if (!Number.isNaN(d.getTime())) onChange({ kind: "once", at: d.toISOString() });
        }}
        className="rounded border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-surface))] px-2 py-1"
      />
      <span className="text-[11px] text-[hsl(var(--fc-fg-muted))]">{timezone}</span>
    </label>
  );
}

function TimeRow({
  hour,
  minute,
  timezone,
  onChange,
}: {
  hour: number;
  minute: number;
  timezone: string;
  onChange: (hour: number, minute: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-[hsl(var(--fc-fg-secondary))]">At</span>
      <input
        type="time"
        value={toTimeInputValue(hour, minute)}
        onChange={(e) => {
          const t = parseTimeInput(e.target.value);
          onChange(t.hour, t.minute);
        }}
        className="rounded border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-surface))] px-2 py-1"
      />
      <span className="text-[11px] text-[hsl(var(--fc-fg-muted))]">{timezone}</span>
    </label>
  );
}

function WeeklyForm({
  value,
  onChange,
  timezone,
}: {
  value: Extract<FrequencyInput, { kind: "weekly" }>;
  onChange: (v: FrequencyInput) => void;
  timezone: string;
}) {
  function toggleDay(d: number) {
    const set = new Set(value.days);
    if (set.has(d)) set.delete(d);
    else set.add(d);
    onChange({ ...value, days: [...set].sort((a, b) => a - b) });
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[hsl(var(--fc-fg-secondary))] mr-1">On</span>
        {WEEKDAY_LABELS.map((label, idx) => {
          const on = value.days.includes(idx);
          return (
            <button
              key={idx}
              type="button"
              onClick={() => toggleDay(idx)}
              className={
                "rounded px-2 py-0.5 text-xs transition-colors " +
                (on
                  ? "bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))]"
                  : "bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-secondary))] hover:bg-[hsl(var(--fc-bg-secondary))]")
              }
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onChange({ ...value, days: [1, 2, 3, 4, 5] })}
          className="ml-2 text-[11px] text-[hsl(var(--brand-accent))] hover:underline"
        >
          weekdays
        </button>
      </div>
      <TimeRow
        hour={value.hour}
        minute={value.minute}
        timezone={timezone}
        onChange={(h, m) => onChange({ ...value, hour: h, minute: m })}
      />
    </div>
  );
}

function MonthlyForm({
  value,
  onChange,
  timezone,
}: {
  value: Extract<FrequencyInput, { kind: "monthly" }>;
  onChange: (v: FrequencyInput) => void;
  timezone: string;
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2">
        <span className="text-[hsl(var(--fc-fg-secondary))]">On day</span>
        <input
          type="number"
          min={1}
          max={31}
          value={value.day}
          onChange={(e) => onChange({ ...value, day: clampDom(Number(e.target.value) || 1) })}
          className="w-16 rounded border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-surface))] px-2 py-1"
        />
        <span className="text-[hsl(var(--fc-fg-secondary))]">of every month</span>
      </label>
      <TimeRow
        hour={value.hour}
        minute={value.minute}
        timezone={timezone}
        onChange={(h, m) => onChange({ ...value, hour: h, minute: m })}
      />
      <p className="text-[11px] text-[hsl(var(--fc-fg-muted))]">
        Days 29–31 are skipped in months that don&apos;t have them.
      </p>
    </div>
  );
}

function EveryForm({
  value,
  onChange,
}: {
  value: Extract<FrequencyInput, { kind: "every" }>;
  onChange: (v: FrequencyInput) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-[hsl(var(--fc-fg-secondary))]">Every</span>
      <input
        type="number"
        min={1}
        value={value.n}
        onChange={(e) => onChange({ ...value, n: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
        className="w-20 rounded border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-surface))] px-2 py-1"
      />
      <select
        value={value.unit}
        onChange={(e) => onChange({ ...value, unit: e.target.value as EveryUnit })}
        className="rounded border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-surface))] px-2 py-1"
      >
        <option value="minutes">minutes</option>
        <option value="hours">hours</option>
      </select>
    </label>
  );
}

function CustomForm({
  value,
  onChange,
}: {
  value: Extract<FrequencyInput, { kind: "custom" }>;
  onChange: (v: FrequencyInput) => void;
}) {
  const check = validateCronExpr(value.expr);
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2">
        <span className="text-[hsl(var(--fc-fg-secondary))]">Cron</span>
        <input
          type="text"
          value={value.expr}
          spellCheck={false}
          onChange={(e) => onChange({ kind: "custom", expr: e.target.value })}
          placeholder="min hour day month weekday"
          className="flex-1 rounded border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-surface))] px-2 py-1 font-mono"
        />
      </label>
      {!check.ok && <p className="text-[11px] text-red-600">{check.error}</p>}
      <p className="text-[11px] text-[hsl(var(--fc-fg-muted))]">
        5 fields. e.g. <code className="font-mono">30 8 * * 1-5</code> = 8:30 AM every weekday.
        The gateway validates the final expression.
      </p>
    </div>
  );
}
