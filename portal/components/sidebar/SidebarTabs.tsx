"use client";

import { useCallback, useEffect, useState } from "react";
import FileExplorer from "@/components/files/FileExplorer";
import { SessionList } from "@/components/sessions/SessionList";
import ApprovalsPanel, {
  type ApprovalsData,
} from "@/components/approvals/ApprovalsPanel";

interface SidebarTabsProps {
  agentId: string;
  targetUserId: string;
  activeSessionKey: string;
  className?: string;
  initialTab?: "sessions" | "files" | "approvals";
}

type TabKey = "sessions" | "files" | "approvals";

export function SidebarTabs({
  agentId,
  targetUserId,
  activeSessionKey,
  className,
  initialTab = "sessions",
}: SidebarTabsProps) {
  const [tab, setTab] = useState<TabKey>(initialTab);

  // Approvals data is fetched here (not in the panel) so the tab can show a
  // pending-count badge even while another tab is active.
  const [approvals, setApprovals] = useState<ApprovalsData | null>(null);
  const [loadingApprovals, setLoadingApprovals] = useState(false);

  const loadApprovals = useCallback(async () => {
    setLoadingApprovals(true);
    try {
      const r = await fetch(
        `/api/portal/approvals?agent=${encodeURIComponent(agentId)}`,
        { cache: "no-store" },
      );
      if (r.ok) setApprovals((await r.json()) as ApprovalsData);
    } catch {
      /* best effort — poll will retry */
    } finally {
      setLoadingApprovals(false);
    }
  }, [agentId]);

  useEffect(() => {
    void loadApprovals();
    // Backstop poll. The primary trigger is the `flatclaw:approvals-refresh`
    // event the chat panel fires the instant a turn finishes composing a held
    // action, so this can stay relatively gentle.
    const t = setInterval(() => void loadApprovals(), 8_000);

    // Instant refresh when an agent turn completes (it may have just composed
    // a transfer/loan), and whenever the operator returns to the tab.
    const onSignal = () => void loadApprovals();
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadApprovals();
    };
    window.addEventListener("flatclaw:approvals-refresh", onSignal);
    window.addEventListener("focus", onSignal);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      window.removeEventListener("flatclaw:approvals-refresh", onSignal);
      window.removeEventListener("focus", onSignal);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadApprovals]);

  const pendingCount = approvals?.pending.length ?? 0;

  return (
    <div
      className={
        "flex flex-col rounded-lg bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] overflow-hidden " +
        (className ?? "")
      }
    >
      <div
        role="tablist"
        className="flex border-b border-[hsl(var(--fc-bg-tertiary))] text-xs"
      >
        <Tab label="Sessions" active={tab === "sessions"} onClick={() => setTab("sessions")} />
        <Tab label="Files" active={tab === "files"} onClick={() => setTab("files")} />
        <Tab
          label="Approvals"
          badge={pendingCount}
          active={tab === "approvals"}
          onClick={() => setTab("approvals")}
        />
      </div>
      <div className="flex-1 min-h-0">
        {tab === "sessions" ? (
          <SessionList
            agentId={agentId}
            targetUserId={targetUserId}
            activeKey={activeSessionKey}
          />
        ) : tab === "files" ? (
          <FileExplorer
            agentId={agentId}
            targetUserId={targetUserId}
            className="h-full border-0 rounded-none ring-0 bg-transparent"
          />
        ) : (
          <ApprovalsPanel
            agentId={agentId}
            data={approvals}
            loading={loadingApprovals}
            onChanged={loadApprovals}
          />
        )}
      </div>
    </div>
  );
}

function Tab({
  label,
  active,
  onClick,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "flex-1 px-3 py-2 transition inline-flex items-center justify-center gap-1.5 " +
        (active
          ? "text-[hsl(var(--fc-fg-primary))] font-medium border-b-2 border-[hsl(var(--brand-accent))] -mb-px"
          : "text-[hsl(var(--fc-fg-muted))] hover:text-[hsl(var(--fc-fg-secondary))]")
      }
    >
      {label}
      {badge != null && badge > 0 && (
        <span className="inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] font-bold bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))]">
          {badge}
        </span>
      )}
    </button>
  );
}
