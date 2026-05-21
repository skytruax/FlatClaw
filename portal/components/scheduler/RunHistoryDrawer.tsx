"use client";

import { useEffect, useState } from "react";
import type { ScheduledRunDTO, ScheduledTaskDTO } from "@/lib/scheduler/contract";

/**
 * Right-side drawer listing a task's past runs (`cron.runs`). Each "ok" run
 * links to the session transcript the run executed in.
 */
export default function RunHistoryDrawer({
  task,
  targetUserId,
  chatLinkBase,
  onClose,
}: {
  task: ScheduledTaskDTO;
  targetUserId?: string;
  /** Base path the "open session" link points at; `?session=` (or `&session=`) is appended. */
  chatLinkBase: string;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<ScheduledRunDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams();
    if (targetUserId) qs.set("targetUserId", targetUserId);
    qs.set("limit", "50");
    fetch(`/api/portal/scheduled-tasks/${encodeURIComponent(task.id)}/runs?${qs}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) setError(j.error ?? `HTTP ${r.status}`);
        else setRuns(j.runs ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [task.id, targetUserId]);

  function sessionHref(key: string): string {
    const sep = chatLinkBase.includes("?") ? "&" : "?";
    return `${chatLinkBase}${sep}session=${encodeURIComponent(key)}`;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-md flex-col bg-[hsl(var(--fc-bg-surface))] shadow-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))]">
        <div className="flex items-center justify-between border-b border-[hsl(var(--fc-bg-tertiary))] px-5 py-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-[hsl(var(--fc-fg-muted))]">
              Run history
            </div>
            <div className="truncate text-sm font-semibold">{task.name}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[hsl(var(--fc-fg-muted))] hover:text-[hsl(var(--fc-fg-primary))]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 text-sm">
          {error && <div className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</div>}
          {!error && runs === null && (
            <div className="text-[hsl(var(--fc-fg-muted))]">Loading…</div>
          )}
          {!error && runs !== null && runs.length === 0 && (
            <div className="text-[hsl(var(--fc-fg-muted))]">
              No runs yet. Use “Run now” to test it.
            </div>
          )}
          {!error && runs !== null && runs.length > 0 && (
            <ul className="space-y-2">
              {runs.map((run, i) => (
                <li
                  key={run.runId ?? `${run.ts}-${i}`}
                  className="rounded border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-soft))] px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <StatusGlyph status={run.status} />
                    <span className="text-[hsl(var(--fc-fg-secondary))]">
                      {new Date(run.ts).toLocaleString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    {run.durationMs != null && (
                      <span className="text-[11px] text-[hsl(var(--fc-fg-muted))]">
                        · {formatDuration(run.durationMs)}
                      </span>
                    )}
                    {run.sessionKey && (
                      <a
                        href={sessionHref(run.sessionKey)}
                        className="ml-auto text-[11px] text-[hsl(var(--brand-accent))] hover:underline"
                      >
                        open session
                      </a>
                    )}
                  </div>
                  {run.status === "error" && run.error && (
                    <div className="mt-1 break-words font-mono text-[11px] text-red-600">
                      {run.error}
                    </div>
                  )}
                  {run.status === "skipped" && (
                    <div className="mt-1 text-[11px] text-amber-600">
                      Skipped — a previous run was still in progress.
                    </div>
                  )}
                  {run.summary && run.status !== "error" && (
                    <div className="mt-1 text-[11px] text-[hsl(var(--fc-fg-muted))] line-clamp-3">
                      {run.summary}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusGlyph({ status }: { status: ScheduledRunDTO["status"] }) {
  if (status === "ok") return <span className="text-[hsl(var(--brand-accent))]">✓</span>;
  if (status === "error") return <span className="text-red-600">✗</span>;
  if (status === "skipped") return <span className="text-amber-600">∅</span>;
  return <span className="text-[hsl(var(--fc-fg-muted))]">·</span>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}
