"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Layers, Pencil, X } from "lucide-react";

interface PortalSession {
  sessionKey: string;
  title: string | null;
  description?: string | null;
  isMain: boolean;
  lastMessageAt: number | null;
  messageCount: number;
  totalTokens?: number | null;
  contextTokens?: number | null;
  compactionCheckpointCount?: number;
}

interface SessionListProps {
  agentId: string;
  /**
   * Active sessionKey (read from `?session=` if present, else the agent's
   * main). When the list is clicked, we navigate by setting the param.
   */
  activeKey: string;
  /** Optional: target user id, for the admin "chat as" path. */
  targetUserId?: string;
  /** Polling cadence — keeps the list fresh without a manual refresh. */
  pollMs?: number;
}

/**
 * Smart timestamp: today renders as "2:14 PM", anything older renders as a
 * date. Sessions don't need second-precision; the goal is glanceable
 * ordering, not stopwatch UX.
 */
function formatTime(ms: number | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function SessionList({
  agentId,
  activeKey,
  targetUserId,
  pollMs = 8_000,
}: SessionListProps) {
  const router = useRouter();
  const sp = useSearchParams();
  const [sessions, setSessions] = useState<PortalSession[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const url = new URL(
        "/api/portal/sessions",
        window.location.origin,
      );
      if (targetUserId) url.searchParams.set("agent", agentId);
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      const data = (await r.json()) as { sessions: PortalSession[] };
      setSessions(data.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [agentId, targetUserId]);

  useEffect(() => {
    void refetch();
    const t = setInterval(() => void refetch(), pollMs);
    return () => clearInterval(t);
  }, [refetch, pollMs]);

  const open = useCallback(
    (sessionKey: string) => {
      const params = new URLSearchParams(sp);
      params.set("session", sessionKey);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, sp],
  );

  const onRename = useCallback(
    async (sessionKey: string, currentTitle: string | null, isMain: boolean) => {
      const initial = currentTitle ?? (isMain ? "Main" : "");
      const next = window.prompt("Rename session", initial);
      if (next === null) return; // cancelled
      const title = next.trim();
      if (!title || title === currentTitle) return;
      // Optimistic.
      setSessions((prev) =>
        prev?.map((s) =>
          s.sessionKey === sessionKey ? { ...s, title } : s,
        ) ?? prev,
      );
      try {
        const r = await fetch(
          `/api/portal/sessions/${encodeURIComponent(sessionKey)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
          },
        );
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `${r.status}`);
        }
        void refetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        void refetch(); // pull true state on failure
      }
    },
    [refetch],
  );

  const onDelete = useCallback(
    async (sessionKey: string, isMain: boolean) => {
      if (isMain) return;
      if (!window.confirm("Delete this session? This cannot be undone.")) return;
      try {
        const r = await fetch(
          `/api/portal/sessions/${encodeURIComponent(sessionKey)}`,
          { method: "DELETE" },
        );
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `${r.status}`);
        }
        // If we just deleted the active session, fall back to main.
        if (sessionKey === activeKey) {
          const params = new URLSearchParams(sp);
          params.set("session", `agent:${agentId}:main`);
          router.replace(`?${params.toString()}`, { scroll: false });
        }
        // Optimistic remove + reconcile.
        setSessions((prev) => prev?.filter((s) => s.sessionKey !== sessionKey) ?? prev);
        void refetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [activeKey, agentId, refetch, router, sp],
  );

  const onCreate = useCallback(async () => {
    setCreating(true);
    try {
      const r = await fetch("/api/portal/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(targetUserId ? { agentId } : {}),
        }),
      });
      if (!r.ok) {
        const errJson = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error ?? `${r.status}`);
      }
      const { sessionKey, title } = (await r.json()) as {
        sessionKey: string;
        title: string | null;
      };
      // Switch to the new session FIRST — that updates the URL param the
      // page reads, so the highlight kicks in immediately. Then optimistic
      // prepend so the new row appears even before the gateway list catches
      // up. Final refetch reconciles with the source of truth.
      open(sessionKey);
      setSessions((prev) => {
        if (!prev) return prev;
        if (prev.some((s) => s.sessionKey === sessionKey)) return prev;
        return [
          ...prev,
          {
            sessionKey,
            title: title ?? null,
            isMain: false,
            lastMessageAt: Date.now(),
            messageCount: 0,
          },
        ];
      });
      void refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [agentId, targetUserId, refetch, open]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--fc-bg-tertiary))] shrink-0">
        <span className="text-xs font-medium text-[hsl(var(--fc-fg-secondary))]">
          Sessions
        </span>
        <button
          type="button"
          onClick={onCreate}
          disabled={creating}
          className="text-[10.5px] text-[hsl(var(--brand-accent))] hover:underline disabled:opacity-50"
        >
          {creating ? "creating…" : "+ New"}
        </button>
      </div>
      {error && (
        <div className="px-3 py-2 text-[10.5px] text-red-600 bg-red-50">
          {error}
        </div>
      )}
      <ul className="flex-1 overflow-y-auto">
        {sessions === null ? (
          <li className="px-3 py-2 text-xs text-[hsl(var(--fc-fg-muted))]">
            loading…
          </li>
        ) : sessions.length === 0 ? (
          <li className="px-3 py-2 text-xs text-[hsl(var(--fc-fg-muted))]">
            no sessions yet
          </li>
        ) : (
          sessions.map((s) => {
            const active = s.sessionKey === activeKey;
            return (
              <li key={s.sessionKey} className="relative group">
                <button
                  type="button"
                  onClick={() => open(s.sessionKey)}
                  className={
                    "w-full text-left px-3 py-2 border-b border-[hsl(var(--fc-bg-tertiary))]/40 hover:bg-[hsl(var(--fc-bg-tertiary))]/40 " +
                    (active
                      ? "bg-[hsl(var(--brand-accent))/0.10] border-l-2 border-l-[hsl(var(--brand-accent))]"
                      : "")
                  }
                >
                  {/* Title — wraps to two lines. */}
                  <div
                    className={
                      "text-xs leading-snug line-clamp-1 break-all pr-1 " +
                      (active
                        ? "font-medium text-[hsl(var(--fc-fg-primary))]"
                        : "text-[hsl(var(--fc-fg-secondary))]")
                    }
                  >
                    {s.title ?? (s.isMain ? "Main" : sessionKeyShort(s.sessionKey))}
                  </div>
                  {/* Description preview — first 120 chars of the most
                      recent message, plain-text. Hidden when the gateway
                      didn't return one (fresh session, etc.). */}
                  {s.description && (
                    <div className="mt-0.5 text-[11px] leading-snug line-clamp-2 text-[hsl(var(--fc-fg-muted))] pr-1">
                      {s.description}
                    </div>
                  )}
                  {/* Meta line — smart timestamp (today=time, older=date)
                      + message count + compaction badges. */}
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-[hsl(var(--fc-fg-muted))]">
                    {s.lastMessageAt !== null && (
                      <span>{formatTime(s.lastMessageAt)}</span>
                    )}
                    {s.messageCount > 0 && (
                      <span>
                        {s.messageCount} msg{s.messageCount === 1 ? "" : "s"}
                      </span>
                    )}
                    {(s.compactionCheckpointCount ?? 0) > 0 && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[hsl(var(--fc-fg-secondary))]"
                        title={`Session compacted ${s.compactionCheckpointCount} time(s) — heavy context use`}
                      >
                        <Layers className="w-2.5 h-2.5" />
                        {s.compactionCheckpointCount}
                      </span>
                    )}
                    {s.totalTokens != null && s.contextTokens && (
                      <span
                        className="tabular-nums"
                        title={`${s.totalTokens.toLocaleString()} of ${s.contextTokens.toLocaleString()} tokens used`}
                      >
                        {Math.round((s.totalTokens / s.contextTokens) * 100)}%
                      </span>
                    )}
                    <span className="ml-auto h-4 w-12" aria-hidden />
                  </div>
                </button>
                <div className="absolute right-1.5 bottom-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                  <button
                    type="button"
                    aria-label="Rename session"
                    title="Rename"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onRename(s.sessionKey, s.title, s.isMain);
                    }}
                    className="p-1 rounded text-[hsl(var(--fc-fg-muted))] hover:text-[hsl(var(--brand-accent))] hover:bg-[hsl(var(--fc-bg-tertiary))]"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  {!s.isMain && (
                    <button
                      type="button"
                      aria-label="Delete session"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDelete(s.sessionKey, s.isMain);
                      }}
                      className="p-1 rounded text-[hsl(var(--fc-fg-muted))] hover:text-red-600 hover:bg-red-50"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

function sessionKeyShort(key: string): string {
  // agent:foo:bar → bar; otherwise last segment after last ":"
  const parts = key.split(":");
  return parts[parts.length - 1] || key;
}
