"use client";

import { useState } from "react";
import type { ScheduledTaskDTO } from "@/lib/scheduler/contract";

/**
 * The scheduled-tasks list — one card per task with a status badge, the
 * instruction preview, the human schedule + next/last run, and a row menu.
 */
export default function ScheduledTasksList({
  tasks,
  busyId,
  onRunNow,
  onEdit,
  onTogglePause,
  onDelete,
  onViewHistory,
}: {
  tasks: ScheduledTaskDTO[];
  busyId: string | null;
  onRunNow: (task: ScheduledTaskDTO) => void;
  onEdit: (task: ScheduledTaskDTO) => void;
  onTogglePause: (task: ScheduledTaskDTO) => void;
  onDelete: (task: ScheduledTaskDTO) => void;
  onViewHistory: (task: ScheduledTaskDTO) => void;
}) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-soft))] px-4 py-8 text-center text-sm text-[hsl(var(--fc-fg-muted))]">
        No scheduled tasks yet. Create one to have the agent run something on a schedule.
      </div>
    );
  }

  return (
    // NB: no `overflow-hidden` here — it would clip the per-row ⋮ dropdown
    // when it opens past the last row. First/last rows round their own
    // corners instead so the ring still looks contained.
    <ul className="divide-y divide-[hsl(var(--fc-bg-tertiary))] rounded-lg ring-1 ring-[hsl(var(--fc-bg-tertiary))]">
      {tasks.map((task) => {
        const busy = busyId === task.id;
        const menuOpen = menuOpenId === task.id;
        return (
          <li
            key={task.id}
            className={
              "relative bg-[hsl(var(--fc-bg-surface))] px-4 py-3 first:rounded-t-lg last:rounded-b-lg " +
              (busy ? "opacity-60 " : "") +
              // Lift the row whose menu is open above its siblings (and the
              // chat panel etc. that may sit below this list).
              (menuOpen ? "z-30 " : "")
            }
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-base" aria-hidden>
                {task.oneOff ? "📌" : "⏰"}
              </span>
              <button
                type="button"
                onClick={() => onEdit(task)}
                disabled={busy}
                className="min-w-0 flex-1 cursor-pointer rounded text-left hover:bg-[hsl(var(--fc-bg-soft))] -mx-1 px-1 py-0.5 transition-colors"
                title="Edit task"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{task.name}</span>
                  <StatusBadge task={task} />
                </div>
                {task.instruction && (
                  <p className="mt-0.5 line-clamp-2 text-[13px] text-[hsl(var(--fc-fg-secondary))]">
                    “{task.instruction}”
                  </p>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[hsl(var(--fc-fg-muted))]">
                  <span>{task.scheduleSummary}</span>
                  {!task.enabled ? (
                    <span>· paused</span>
                  ) : task.nextRunAtMs ? (
                    <span>· next: {formatWhen(task.nextRunAtMs)}</span>
                  ) : null}
                  <LastRun task={task} />
                </div>
              </button>

              <div className="relative shrink-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMenuOpenId((id) => (id === task.id ? null : task.id))}
                  className="rounded px-2 py-1 text-[hsl(var(--fc-fg-muted))] hover:bg-[hsl(var(--fc-bg-soft))] hover:text-[hsl(var(--fc-fg-primary))]"
                  aria-label="Task actions"
                >
                  ⋮
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
                    <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-md bg-[hsl(var(--fc-bg-surface))] py-1 text-sm shadow-lg ring-1 ring-[hsl(var(--fc-bg-tertiary))]">
                      <MenuItem
                        label="Run now"
                        onClick={() => {
                          setMenuOpenId(null);
                          onRunNow(task);
                        }}
                      />
                      <MenuItem
                        label="Edit"
                        onClick={() => {
                          setMenuOpenId(null);
                          onEdit(task);
                        }}
                      />
                      <MenuItem
                        label={task.enabled ? "Pause" : "Resume"}
                        onClick={() => {
                          setMenuOpenId(null);
                          onTogglePause(task);
                        }}
                      />
                      <MenuItem
                        label="View run history"
                        onClick={() => {
                          setMenuOpenId(null);
                          onViewHistory(task);
                        }}
                      />
                      <div className="my-1 border-t border-[hsl(var(--fc-bg-tertiary))]" />
                      <MenuItem
                        label="Delete"
                        danger
                        onClick={() => {
                          setMenuOpenId(null);
                          onDelete(task);
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function StatusBadge({ task }: { task: ScheduledTaskDTO }) {
  if (!task.enabled) {
    return <Badge className="bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-secondary))]">⏸ Paused</Badge>;
  }
  if (task.consecutiveErrors > 0) {
    return <Badge className="bg-amber-100 text-amber-800">⚠ Failing</Badge>;
  }
  return <Badge className="bg-emerald-100 text-emerald-800">● Active</Badge>;
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={"shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium " + className}>
      {children}
    </span>
  );
}

function LastRun({ task }: { task: ScheduledTaskDTO }) {
  if (!task.lastRunAtMs) return null;
  if (task.lastRunStatus === "ok")
    return <span title={`Last ran ${formatWhen(task.lastRunAtMs)}`}>· last: ✓</span>;
  if (task.lastRunStatus === "error")
    return (
      <span className="text-red-600" title={task.lastError ?? "error"}>
        · last: ✗ {task.lastError ? truncate(task.lastError, 60) : ""}
      </span>
    );
  if (task.lastRunStatus === "skipped")
    return <span className="text-amber-600">· last: skipped</span>;
  return null;
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "block w-full px-3 py-1.5 text-left hover:bg-[hsl(var(--fc-bg-soft))] " +
        (danger ? "text-red-600" : "text-[hsl(var(--fc-fg-primary))]")
      }
    >
      {label}
    </button>
  );
}

function formatWhen(ms: number): string {
  const d = new Date(ms);
  const now = Date.now();
  const diff = ms - now;
  const absMin = Math.round(Math.abs(diff) / 60000);
  if (absMin < 60) {
    if (diff >= 0) return absMin <= 1 ? "in <1 min" : `in ${absMin} min`;
    return absMin <= 1 ? "just now" : `${absMin} min ago`;
  }
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
