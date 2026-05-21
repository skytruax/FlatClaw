"use client";

import { useEffect, useState, useTransition } from "react";
import Switch from "./Switch";

/**
 * Read-only view of every openclaw OOTB skill, scoped to one user's agent.
 * Pulls live from the gateway via `/api/portal/users/<id>/skills` (which
 * wraps the `skills.status` gateway method).
 *
 * Pass A (today): list + admin tenant enable/disable. No per-user creds
 * form yet — openclaw's `skills.entries.<name>.env` is currently
 * tenant-global, so per-user creds need either an upstream openclaw
 * addition for `agents.entries.<id>.skills.entries.<name>.env`, or each
 * skill wrapped as our own per-user MCP. See docs/mcp-auth-plan.md §4 for
 * the design.
 */

interface SkillRequirement {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
  os?: string[];
}

interface InstallStep {
  id?: string;
  kind?: string;
  label?: string;
  bins?: string[];
}

interface OpenclawSkill {
  name: string;
  description: string;
  emoji?: string;
  homepage?: string;
  source: string;
  bundled: boolean;
  /** openclaw's own opinion (skills.entries.<name>.enabled === false). */
  disabled: boolean;
  eligible: boolean;
  modelVisible: boolean;
  userInvocable: boolean;
  blockedByAllowlist: boolean;
  blockedByAgentFilter: boolean;
  requirements: SkillRequirement;
  missing: SkillRequirement;
  install?: InstallStep[];
  /**
   * FlatClaw tenant policy — admin has explicitly added this skill to the
   * tenant allowlist. The portal materializes this into
   * `agents.defaults.skills`, so default-deny holds: a skill is invisible
   * to every agent unless tenantEnabled is true. Independent from
   * openclaw's `disabled` (which the operator may also flip via the
   * openclaw control UI directly).
   */
  tenantEnabled: boolean;
}

/**
 * Build a list of human-readable "what's missing" reasons for a skill,
 * using `requirements.install` hints when available. Returns one line per
 * missing category (bins, env, os, config, anyBins).
 */
function buildSetupReasons(skill: OpenclawSkill): string[] {
  const out: string[] = [];
  const missing = skill.missing ?? {};

  // openclaw-side disable. Most common cause: an operator clicked Disable
  // in openclaw's own control UI. Toggling tenant-on in our portal will
  // automatically clear this flag, so for the read-only case we just
  // surface it as the reason.
  if (skill.disabled) {
    out.push(
      `Disabled in openclaw (\`skills.entries.${skill.name}.enabled = false\`). Toggling tenant on here will clear the override automatically; or flip it on at openclaw's control UI.`,
    );
  }

  if (missing.os?.length) {
    const osList = missing.os.map(prettyOs).join(" or ");
    out.push(`Only runs on ${osList} (this host doesn't match).`);
  }

  if (missing.bins?.length) {
    for (const bin of missing.bins) {
      const installCmd = pickInstallHint(skill.install, bin);
      if (installCmd) {
        out.push(`Missing CLI \`${bin}\` — ${installCmd}.`);
      } else if (skill.homepage) {
        out.push(`Missing CLI \`${bin}\` — see ${skill.homepage}.`);
      } else {
        out.push(`Missing CLI \`${bin}\`.`);
      }
    }
  }

  if (missing.anyBins?.length) {
    out.push(
      `Need at least one of: ${missing.anyBins.map((b) => `\`${b}\``).join(", ")}.`,
    );
  }

  if (missing.env?.length) {
    const list = missing.env.map((e) => `\`${e}\``).join(", ");
    out.push(`Missing environment variable(s): ${list}.`);
  }

  if (missing.config?.length) {
    const list = missing.config.map((c) => `\`${c}\``).join(", ");
    out.push(`Need openclaw config: ${list}.`);
  }

  return out;
}

function prettyOs(os: string): string {
  if (os === "darwin") return "macOS";
  if (os === "linux") return "Linux";
  if (os === "win32") return "Windows";
  return os;
}

/**
 * Given a skill's `install` array and a bin name, pick the most helpful
 * install hint (e.g. "brew install op" if there's a brew step covering
 * that bin).
 */
function pickInstallHint(
  install: InstallStep[] | undefined,
  bin: string,
): string | null {
  if (!install || install.length === 0) return null;
  // Prefer steps that explicitly cover this bin.
  const matching = install.find((s) => s.bins?.includes(bin)) ?? install[0];
  if (!matching) return null;
  // Reconstruct a friendly install hint from the step's metadata. openclaw
  // doesn't ship raw shell commands here; use `kind` + `label` + bins.
  if (matching.kind === "brew") {
    return `\`brew install ${matching.bins?.join(" ") ?? bin}\``;
  }
  if (matching.kind === "npm") {
    return `\`npm i -g ${matching.bins?.join(" ") ?? bin}\``;
  }
  if (matching.kind === "pip" || matching.kind === "pipx") {
    return `\`${matching.kind} install ${matching.bins?.join(" ") ?? bin}\``;
  }
  if (matching.kind === "cargo") {
    return `\`cargo install ${matching.bins?.join(" ") ?? bin}\``;
  }
  if (matching.label) return matching.label;
  return null;
}

type Filter = "all" | "tenant-on" | "ready" | "needs-setup";

export default function SkillsPanel({ userId }: { userId: string }) {
  const [skills, setSkills] = useState<OpenclawSkill[] | null>(null);
  const [canAdmin, setCanAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Default to "tenant-on" so the operator sees what they've actually
  // enabled, not openclaw's full 50-skill firehose.
  const [filter, setFilter] = useState<Filter>("tenant-on");
  const [search, setSearch] = useState("");

  const refresh = async () => {
    const res = await fetch(`/api/portal/users/${userId}/skills`, {
      cache: "no-store",
    });
    const data = (await res.json()) as
      | {
          ok: true;
          canAdmin: boolean;
          tenantAllowlist: string[];
          skills: OpenclawSkill[];
        }
      | { error: string };
    if ("error" in data) setError(data.error);
    else {
      setSkills(data.skills);
      setCanAdmin(data.canAdmin);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (error) {
    return (
      <div className="rounded bg-red-50 text-red-700 text-xs px-3 py-2">
        Failed to load skills: {error}
      </div>
    );
  }
  if (!skills) {
    return (
      <div className="text-xs text-[hsl(var(--fc-fg-muted))]">
        Loading skills…
      </div>
    );
  }

  const counts = {
    all: skills.length,
    "tenant-on": skills.filter((s) => s.tenantEnabled).length,
    ready: skills.filter((s) => s.eligible).length,
    "needs-setup": skills.filter((s) => !s.eligible).length,
  } as const;

  const visible = skills.filter((s) => {
    if (search.trim() && !`${s.name} ${s.description}`.toLowerCase().includes(search.trim().toLowerCase())) {
      return false;
    }
    if (filter === "tenant-on") return s.tenantEnabled;
    if (filter === "ready") return s.eligible;
    if (filter === "needs-setup") return !s.eligible;
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {(
          [
            ["tenant-on", "Tenant on"],
            ["ready", "Ready"],
            ["needs-setup", "Needs setup"],
            ["all", "All"],
          ] as const
        ).map(([f, label]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={
              "text-[11px] px-2 py-1 rounded ring-1 " +
              (filter === f
                ? "bg-[hsl(var(--brand-accent))/0.15] ring-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent))]"
                : "ring-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-muted))]")
            }
          >
            {label}
            <span className="ml-1 opacity-70">{counts[f]}</span>
          </button>
        ))}
        <input
          type="search"
          placeholder="Filter skills…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto text-xs px-2 py-1 rounded bg-[hsl(var(--fc-bg-primary))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] w-48"
        />
      </div>

      <div className="text-[11px] text-[hsl(var(--fc-fg-muted))]">
        {visible.length} of {skills.length} skills shown.{" "}
        Default-deny: a skill is hidden from every agent until an admin
        flips it on here. (Tenant policy lives in the portal — openclaw&apos;s
        own <code className="font-mono">skills.entries</code> stays
        untouched.)
      </div>

      <div className="space-y-1.5">
        {visible.map((s) => (
          <SkillRow
            key={s.name}
            userId={userId}
            skill={s}
            canAdmin={canAdmin}
            onChanged={refresh}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Renders the bulleted list of "what's missing to make this skill ready."
 * Backtick-wrapped tokens in the reason strings become inline <code>.
 */
function SetupReasonList({ skill }: { skill: OpenclawSkill }) {
  const reasons = buildSetupReasons(skill);
  if (reasons.length === 0) return null;
  return (
    <ul className="text-[11px] text-amber-700 mt-1 space-y-0.5 list-none">
      {reasons.map((r, i) => (
        <li key={i} className="flex gap-1.5">
          <span className="opacity-60">→</span>
          <span>{renderInlineCode(r)}</span>
        </li>
      ))}
      {skill.homepage && (
        <li className="flex gap-1.5">
          <span className="opacity-60">↗</span>
          <a
            href={skill.homepage}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-amber-800"
          >
            {skill.homepage}
          </a>
        </li>
      )}
    </ul>
  );
}

function renderInlineCode(s: string): React.ReactNode {
  const parts = s.split(/(`[^`]+`)/);
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code
          key={i}
          className="font-mono bg-amber-100 text-amber-900 rounded px-1 py-0.5 mx-0.5"
        >
          {p.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function SkillRow({
  userId,
  skill,
  canAdmin,
  onChanged,
}: {
  userId: string;
  skill: OpenclawSkill;
  canAdmin: boolean;
  onChanged: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [opError, setOpError] = useState<string | null>(null);

  const toggle = async (next: boolean) => {
    setOpError(null);
    startTransition(async () => {
      const res = await fetch(
        `/api/portal/users/${userId}/skills/${skill.name}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setOpError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      await onChanged();
    });
  };

  // Status dot color reflects the FlatClaw-tenant view, not openclaw's
  // own opinion: green = tenant on + eligible, amber = tenant on but
  // needs setup, gray = tenant off.
  const dot = !skill.tenantEnabled
    ? "text-[hsl(var(--fc-fg-muted))]"
    : skill.eligible
      ? "text-[hsl(var(--brand-accent))]"
      : "text-amber-600";

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded ring-1 ring-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-surface))]">
      <span className={dot + " text-base shrink-0 w-3 text-center"}>●</span>
      <div className="text-base shrink-0">{skill.emoji ?? "🧩"}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium font-mono">{skill.name}</span>
          {!skill.eligible && (
            <span className="text-[10px] uppercase tracking-wide text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
              needs setup
            </span>
          )}
        </div>
        <div className="text-xs text-[hsl(var(--fc-fg-muted))]">
          {skill.description}
        </div>
        {!skill.eligible && (
          <SetupReasonList skill={skill} />
        )}
        {opError && (
          <div className="text-[10px] text-red-700 mt-0.5">{opError}</div>
        )}
      </div>
      {canAdmin ? (
        <Switch
          checked={skill.tenantEnabled}
          onChange={toggle}
          disabled={pending}
        />
      ) : (
        <span
          className={
            "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 " +
            (skill.tenantEnabled
              ? "text-[hsl(var(--brand-accent))] bg-[hsl(var(--brand-accent))/0.12]"
              : "text-[hsl(var(--fc-fg-muted))] bg-[hsl(var(--fc-bg-tertiary))]")
          }
        >
          {skill.tenantEnabled ? "tenant on" : "tenant off"}
        </span>
      )}
    </div>
  );
}
