"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  GitBranch,
  Layers,
  RotateCcw,
  Scissors,
} from "lucide-react";

export interface CompactionCheckpoint {
  checkpointId: string;
  sessionKey: string;
  sessionId: string;
  createdAt: number;
  reason:
    | "manual"
    | "auto-threshold"
    | "overflow-retry"
    | "timeout-retry"
    | string;
  tokensBefore?: number;
  tokensAfter?: number;
  summary?: string;
  firstKeptEntryId?: string;
}

interface SessionUsageSnapshot {
  totalTokens: number | null;
  totalTokensFresh: boolean;
  contextTokens: number | null;
  compactionCheckpointCount: number;
}

interface CompactionControlsProps {
  sessionKey: string;
  /** Latest token usage snapshot from the sessions list payload. */
  usage: SessionUsageSnapshot;
  /** Checkpoints; refreshed by parent when compaction events arrive. */
  checkpoints: CompactionCheckpoint[];
  onRefresh: () => void;
}

const SOFT_TRIM_RATIO = 0.7;
const HARD_CLEAR_RATIO = 0.85;

function fmtTokens(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function reasonLabel(r: string): string {
  switch (r) {
    case "manual":
      return "manual";
    case "auto-threshold":
      return "auto";
    case "overflow-retry":
      return "overflow";
    case "timeout-retry":
      return "timeout";
    default:
      return r;
  }
}

export default function CompactionControls({
  sessionKey,
  usage,
  checkpoints,
  onRefresh,
}: CompactionControlsProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | "compact" | "restore" | "branch">(null);
  const [error, setError] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (ev: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const r = await fetch(
        `/api/portal/sessions/${encodeURIComponent(sessionKey)}/compaction`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = (await r.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };
      if (!r.ok) throw new Error(json.error ?? `${body.action} failed`);
      return json;
    },
    [sessionKey],
  );

  const compactNow = useCallback(
    async (mode: "full" | "fast") => {
      setBusy("compact");
      setError(null);
      try {
        await post({
          action: "compact",
          ...(mode === "fast" ? { maxLines: 200 } : {}),
        });
        onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [post, onRefresh],
  );

  const restore = useCallback(
    async (checkpointId: string) => {
      if (
        !window.confirm(
          "Restore session to its pre-compaction state? Your current transcript stays intact as a fork point.",
        )
      )
        return;
      setBusy("restore");
      setError(null);
      try {
        await post({ action: "restore", checkpointId });
        onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [post, onRefresh],
  );

  const branch = useCallback(
    async (checkpointId: string) => {
      setBusy("branch");
      setError(null);
      try {
        const res = await post({ action: "branch", checkpointId });
        onRefresh();
        const r = res as { key?: string };
        if (r.key) window.location.href = `?session=${encodeURIComponent(r.key)}`;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [post, onRefresh],
  );

  const ratio =
    usage.contextTokens && usage.totalTokens != null
      ? usage.totalTokens / usage.contextTokens
      : 0;
  const ratioClamped = Math.min(1, Math.max(0, ratio));
  const meterColor =
    ratioClamped >= HARD_CLEAR_RATIO
      ? "bg-orange-500"
      : ratioClamped >= SOFT_TRIM_RATIO
        ? "bg-yellow-500"
        : "bg-[hsl(var(--brand-accent))]";

  const compactionCount = usage.compactionCheckpointCount;

  return (
    <div className="relative" ref={popRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Context usage and compaction"
        className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-[hsl(var(--fc-bg-tertiary))] transition"
      >
        <div className="flex flex-col items-end">
          <div className="text-[10px] tabular-nums text-[hsl(var(--fc-fg-secondary))]">
            {fmtTokens(usage.totalTokens)}
            <span className="text-[hsl(var(--fc-fg-muted))]"> / {fmtTokens(usage.contextTokens)}</span>
            {!usage.totalTokensFresh && usage.totalTokens != null && (
              <span className="ml-1 text-[hsl(var(--fc-fg-muted))]">~</span>
            )}
          </div>
          <div className="mt-0.5 w-24 h-1 rounded-full bg-[hsl(var(--fc-bg-tertiary))] overflow-hidden">
            <div
              className={"h-full transition-all " + meterColor}
              style={{ width: `${ratioClamped * 100}%` }}
            />
          </div>
        </div>
        {compactionCount > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-secondary))]">
            <Layers className="w-3 h-3" />
            {compactionCount}
          </span>
        )}
        <ChevronDown
          className={
            "w-3.5 h-3.5 text-[hsl(var(--fc-fg-muted))] transition-transform " +
            (open ? "rotate-180" : "")
          }
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 rounded-lg shadow-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-surface))] overflow-hidden">
          <div className="px-3 py-2 border-b border-[hsl(var(--fc-bg-tertiary))]">
            <div className="text-xs font-semibold text-[hsl(var(--fc-fg-primary))]">
              Context · {fmtTokens(usage.totalTokens)} / {fmtTokens(usage.contextTokens)}
            </div>
            <div className="text-[10px] text-[hsl(var(--fc-fg-muted))] mt-0.5">
              {usage.totalTokensFresh
                ? "fresh from latest run"
                : "estimate — refreshes after next turn"}
              {ratioClamped >= HARD_CLEAR_RATIO ? (
                <span className="ml-1 text-orange-600 font-medium">
                  · hard-clear zone
                </span>
              ) : ratioClamped >= SOFT_TRIM_RATIO ? (
                <span className="ml-1 text-yellow-700 font-medium">
                  · soft-trim zone
                </span>
              ) : null}
            </div>
          </div>
          <div className="p-2 space-y-1 border-b border-[hsl(var(--fc-bg-tertiary))]">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => compactNow("full")}
              className="w-full flex items-start gap-2 px-2 py-1.5 rounded text-left text-xs hover:bg-[hsl(var(--fc-bg-soft))] disabled:opacity-50"
            >
              <Scissors className="w-3.5 h-3.5 mt-0.5 text-[hsl(var(--brand-primary))]" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[hsl(var(--fc-fg-primary))]">
                  Compact now (full)
                </div>
                <div className="text-[10px] text-[hsl(var(--fc-fg-muted))]">
                  Summarize older turns. ~30-60 s. Uses the model.
                </div>
              </div>
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => compactNow("fast")}
              className="w-full flex items-start gap-2 px-2 py-1.5 rounded text-left text-xs hover:bg-[hsl(var(--fc-bg-soft))] disabled:opacity-50"
            >
              <Scissors className="w-3.5 h-3.5 mt-0.5 text-[hsl(var(--fc-fg-secondary))]" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[hsl(var(--fc-fg-primary))]">
                  Tail-trim (fast)
                </div>
                <div className="text-[10px] text-[hsl(var(--fc-fg-muted))]">
                  Drop oldest entries to last 200 lines. Instant. No model call.
                </div>
              </div>
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--fc-fg-muted))] bg-[hsl(var(--fc-bg-soft))]">
              Checkpoints {checkpoints.length > 0 && `(${checkpoints.length})`}
            </div>
            {checkpoints.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-[hsl(var(--fc-fg-muted))] text-center">
                No compactions yet
              </div>
            ) : (
              <ul className="divide-y divide-[hsl(var(--fc-bg-tertiary))]">
                {[...checkpoints]
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((c) => (
                    <li key={c.checkpointId} className="px-3 py-2 text-xs">
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <span className="font-mono text-[10px] text-[hsl(var(--fc-fg-muted))]">
                          {new Date(c.createdAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="text-[10px] uppercase font-semibold text-[hsl(var(--fc-fg-secondary))]">
                          {reasonLabel(c.reason)}
                        </span>
                      </div>
                      {(c.tokensBefore != null || c.tokensAfter != null) && (
                        <div className="text-[10px] text-[hsl(var(--fc-fg-secondary))] mb-1.5 tabular-nums">
                          {fmtTokens(c.tokensBefore)} → {fmtTokens(c.tokensAfter)}
                        </div>
                      )}
                      {c.summary && (
                        <div className="text-[11px] text-[hsl(var(--fc-fg-primary))] line-clamp-2 mb-1.5">
                          {c.summary}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => restore(c.checkpointId)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium hover:bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-secondary))] disabled:opacity-50"
                          title="Restore to before this compaction"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Restore
                        </button>
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => branch(c.checkpointId)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium hover:bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-secondary))] disabled:opacity-50"
                          title="Open this checkpoint as a new session"
                        >
                          <GitBranch className="w-3 h-3" />
                          Branch
                        </button>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </div>
          {error && (
            <div className="px-3 py-2 border-t border-[hsl(var(--fc-bg-tertiary))] flex items-start gap-2 bg-red-50">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 text-red-600 shrink-0" />
              <span className="text-[11px] text-red-700">{error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Inline marker rendered between transcript bubbles when a compaction
 * happened at this point. Multiple checkpoints can stack if more than one
 * compaction occurred between two adjacent bubbles.
 */
export function CompactionMarker({
  checkpoint,
}: {
  checkpoint: CompactionCheckpoint;
}) {
  const reduction =
    checkpoint.tokensBefore != null && checkpoint.tokensAfter != null
      ? `${fmtTokens(checkpoint.tokensBefore)} → ${fmtTokens(checkpoint.tokensAfter)}`
      : null;
  return (
    <div className="flex items-center gap-2 my-1.5">
      <div className="flex-1 border-t border-dashed border-[hsl(var(--fc-bg-tertiary))]" />
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[hsl(var(--fc-bg-soft))] text-[10px] text-[hsl(var(--fc-fg-secondary))]">
        <Layers className="w-3 h-3" />
        <span>
          Compacted ({reasonLabel(checkpoint.reason)})
          {reduction && (
            <span className="ml-1 tabular-nums text-[hsl(var(--fc-fg-muted))]">
              · {reduction}
            </span>
          )}
        </span>
      </div>
      <div className="flex-1 border-t border-dashed border-[hsl(var(--fc-bg-tertiary))]" />
    </div>
  );
}
