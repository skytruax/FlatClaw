"use client";

import { useState } from "react";
import ServicesPanel from "./ServicesPanel";
import SkillsPanel from "./SkillsPanel";

/**
 * Tabbed wrapper for everything a user (or admin acting on a user's behalf)
 * can connect to:
 *
 *   - Skills        — openclaw OOTB skills (1password, gh, …) toggled
 *                     tenant-wide by the admin. Per-user credentials in a
 *                     follow-up pass (see docs/mcp-auth-plan.md §4).
 *   - Custom MCP    — services we own end-to-end (cpanel, caldav, future
 *                     Slack / Notion / Jira / HubSpot / GitHub). Each is a
 *                     plugin in `lib/openclaw/services/` with its own
 *                     credential form rendered from the descriptor.
 */

type Tab = "skills" | "custom";

export default function ConnectionsTabs({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>("custom");
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 border-b border-[hsl(var(--fc-bg-tertiary))]">
        <TabButton active={tab === "custom"} onClick={() => setTab("custom")}>
          Custom MCP
        </TabButton>
        <TabButton active={tab === "skills"} onClick={() => setTab("skills")}>
          Skills
        </TabButton>
      </div>
      {tab === "custom" ? (
        <ServicesPanel userId={userId} />
      ) : (
        <SkillsPanel userId={userId} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "text-sm px-3 py-1.5 -mb-px border-b-2 transition-colors " +
        (active
          ? "border-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent))]"
          : "border-transparent text-[hsl(var(--fc-fg-muted))] hover:text-[hsl(var(--fc-fg-secondary))]")
      }
    >
      {children}
    </button>
  );
}
