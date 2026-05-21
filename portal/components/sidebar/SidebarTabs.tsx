"use client";

import { useState } from "react";
import FileExplorer from "@/components/files/FileExplorer";
import { SessionList } from "@/components/sessions/SessionList";

interface SidebarTabsProps {
  agentId: string;
  targetUserId: string;
  activeSessionKey: string;
  className?: string;
  initialTab?: "sessions" | "files";
}

export function SidebarTabs({
  agentId,
  targetUserId,
  activeSessionKey,
  className,
  initialTab = "sessions",
}: SidebarTabsProps) {
  const [tab, setTab] = useState<"sessions" | "files">(initialTab);
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
      </div>
      <div className="flex-1 min-h-0">
        {tab === "sessions" ? (
          <SessionList
            agentId={agentId}
            targetUserId={targetUserId}
            activeKey={activeSessionKey}
          />
        ) : (
          <FileExplorer
            agentId={agentId}
            targetUserId={targetUserId}
            className="h-full border-0 rounded-none ring-0 bg-transparent"
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
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "flex-1 px-3 py-2 transition " +
        (active
          ? "text-[hsl(var(--fc-fg-primary))] font-medium border-b-2 border-[hsl(var(--brand-accent))] -mb-px"
          : "text-[hsl(var(--fc-fg-muted))] hover:text-[hsl(var(--fc-fg-secondary))]")
      }
    >
      {label}
    </button>
  );
}
