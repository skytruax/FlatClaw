"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronDown, Scissors } from "lucide-react";

// Context meter + on-demand compaction. There is no checkpoint list any more:
// openclaw 2026.9.6 retired compaction checkpoints (list / restore / branch)
// while keeping the history itself.

interface SessionUsageSnapshot {
  totalTokens: number | null;
  totalTokensFresh: boolean;
  contextTokens: number | null;
}

interface CompactionControlsProps {
  sessionKey: string;
  /** Latest token usage snapshot from the sessions list payload. */
  usage: SessionUsageSnapshot;
  onRefresh: () => void;
}

const SOFT_TRIM_RATIO = 0.7;
const HARD_CLEAR_RATIO = 0.85;

function fmtTokens(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function CompactionControls({
  sessionKey,
  usage,
  onRefresh,
}: CompactionControlsProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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

  const compactNow = useCallback(
    async (mode: "full" | "fast") => {
      setBusy(true);
      setError(null);
      try {
        const r = await fetch(
          `/api/portal/sessions/${encodeURIComponent(sessionKey)}/compaction`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "compact",
              ...(mode === "fast" ? { maxLines: 200 } : {}),
            }),
          },
        );
        const json = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) throw new Error(json.error ?? "compact failed");
        onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [sessionKey, onRefresh],
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
          <div className="p-2 space-y-1">
            <button
              type="button"
              disabled={busy}
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
              disabled={busy}
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
