/**
 * Per-service subagent identities (Phase D — scaffold, not yet activated).
 *
 * Goal: rather than the user's primary agent carrying ~250 tool schemas
 * (cpanel 170 + caldav 40 + google 58 + jira 31), the primary agent gets a
 * tiny "router" toolset — bundled fs/exec + `sessions_spawn` — and dispatches
 * service-specific work to a focused subagent that holds only that service's
 * MCP. The subagent runs in its own session, returns a result, and the
 * primary's context never sees the schema for services it didn't touch.
 *
 * Mechanism: openclaw 2026.5.5 has native subagent support via the
 * `sessions_spawn` tool ([openclaw/src/agents/tools/sessions-spawn-tool.ts]).
 * Configured via:
 *   - agents[].subagents.allowAgents — which agent IDs can be spawned
 *   - agents[].tools.allow / .deny    — what each agent can call
 *
 * The naming convention used here is `<userId>:<service>` so RBAC stays
 * symmetric with our existing per-user MCP server names. E.g. Skyler's
 * cpanel subagent is `skyler-flatclaw-org:cpanel`.
 *
 * STATUS: scaffold only. Not invoked anywhere by default. Activated by the
 * `FLATCLAW_SERVICE_SUBAGENTS` env var on the portal side, which gates the
 * call to `provisionServiceSubagentsForUser` from the user provisioning
 * flow. Until then the existing flat-toolset model stays in effect.
 */
import type { ConfigBlob } from "./agent-tool-policy";

/** Services we will eventually route through dedicated subagents. */
export const SUBAGENT_SERVICES = ["cpanel", "caldav", "google", "jira"] as const;
export type SubagentService = (typeof SUBAGENT_SERVICES)[number];

export interface ServiceSubagentConfig {
  /** Parent (primary) agent ID — the user's agent. */
  parentAgentId: string;
  /** safeAgentId form used in MCP server names (e.g. skyler-flatclaw-org). */
  safeAgentId: string;
  /** Identity name to render in SOUL.md / IDENTITY.md (e.g. "Skyler · cPanel runner"). */
  identityName: string;
}

/** Subagent ID for a (user, service) pair. */
export function subagentIdFor(safeAgentId: string, service: SubagentService): string {
  return `${safeAgentId}-${service}`;
}

/** MCP server name a given subagent's allow-list should include. */
export function mcpServerNameFor(safeAgentId: string, service: SubagentService): string {
  return `${service}-${safeAgentId}`;
}

/**
 * Compute the desired `agents[]` shape for a single user — primary agent +
 * per-service subagents. The caller merges this into the openclaw config.
 *
 * Primary agent gets `subagents.allowAgents` listing every per-service
 * subagent ID it's allowed to spawn, plus a `tools.deny` that hides every
 * service MCP behind the subagent. A direct call to `cpanel-skyler__*`
 * from the primary now fails at the policy pipeline; the only path is
 * through `sessions_spawn`.
 *
 * Each subagent gets `tools.allow` covering its own service prefix + the
 * workspace essentials (read/write/edit/exec/grep/glob) so it can land
 * results in the user's workspace.
 */
export function buildServiceSubagentEntries(args: {
  cfg: ServiceSubagentConfig;
  /** Which services this user has credentials for. Subagents are only minted for connected services. */
  connectedServices: SubagentService[];
}): {
  primary: { id: string; subagentsAllow: string[]; toolsDeny: string[] };
  subagents: Array<{
    id: string;
    parentAgentId: string;
    service: SubagentService;
    toolsAllow: string[];
    toolsDeny: string[];
  }>;
} {
  const { cfg, connectedServices } = args;
  const subagentIds = connectedServices.map((s) => subagentIdFor(cfg.safeAgentId, s));

  // Primary denies every service MCP it might otherwise reach for. Forces
  // the dispatcher pattern: the primary uses sessions_spawn, never calls
  // <svc>-<id>__* directly.
  const primaryToolsDeny = connectedServices.map(
    (s) => `${mcpServerNameFor(cfg.safeAgentId, s)}__*`,
  );

  const subagents = connectedServices.map((service) => {
    const ownMcp = mcpServerNameFor(cfg.safeAgentId, service);
    // Each subagent allows: its own service MCP, the workspace fs primitives
    // (so it can persist results back to the user's workspace), and exec
    // for ad-hoc ops. Everything else stays denied via openclaw's
    // built-in subagent baseline.
    const toolsAllow = [
      `${ownMcp}__*`,
      "read",
      "write",
      "edit",
      "grep",
      "glob",
      "exec",
      // sessions_send is how the subagent reports back to the primary
      "sessions_send",
    ];
    // Deny every OTHER service MCP — even though pi-tools.policy already
    // restricts tool surface, being explicit keeps the policy pipeline's
    // intent obvious in the config snapshot.
    const toolsDeny = SUBAGENT_SERVICES.filter((s) => s !== service).map(
      (s) => `${mcpServerNameFor(cfg.safeAgentId, s)}__*`,
    );
    return {
      id: subagentIdFor(cfg.safeAgentId, service),
      parentAgentId: cfg.parentAgentId,
      service,
      toolsAllow,
      toolsDeny,
    };
  });

  return {
    primary: {
      id: cfg.parentAgentId,
      subagentsAllow: subagentIds,
      toolsDeny: primaryToolsDeny,
    },
    subagents,
  };
}

/**
 * SOUL.md template for a per-service subagent. Spelled out so the subagent
 * knows it's a focused worker, not a general-purpose assistant.
 */
export function buildServiceSubagentSoul(args: {
  service: SubagentService;
  parentIdentityName: string;
  serviceLabel: string;
  agentId: string;
}): string {
  const cap = args.service.charAt(0).toUpperCase() + args.service.slice(1);
  return `# ${cap} runner — ${args.parentIdentityName}

You are a focused **${args.serviceLabel}** subagent for ${args.parentIdentityName}'s primary FlatClaw agent.

Your role:
- You receive a single task description from the primary agent (via \`sessions_spawn\`).
- You reach for the **${args.service}** MCP tools, plus your workspace, to complete that task.
- You return a concise summary back to the primary via \`sessions_send\` — one line if possible. The primary will quote your result in its own reply to the user; don't write a chat-shaped response.

Your workspace is at \`~/.openclaw/workspace-${args.agentId}/\` — share with the primary so it can read your output. Files you write here are visible to the primary.

You do not see other services' tools. If the task seems to require another service, return an explanation — the primary will dispatch a different subagent.

Do not spawn further subagents. Stay shallow.

Reasoning style: terse, action-oriented, no preamble. Tool calls over prose.
`;
}

/**
 * Patch the openclaw config with the subagent layout for one user.
 *
 * Idempotent. Removes per-service subagent entries for services not in
 * connectedServices, adds/updates entries for services that are. Mutates
 * the cfg object in place and returns it for convenience.
 *
 * Caller is responsible for persisting via `config.set` and recomputing
 * RBAC deny lists across other users (separate concern — see
 * `agent-tool-policy.ts`).
 *
 * NOTE: this function does NOT call `agents.create` for subagent
 * identities — you have to do that separately. The subagent agent IDs
 * referenced here must already exist as openclaw agents on the gateway.
 */
export function applyServiceSubagentLayout(
  cfg: ConfigBlob,
  args: {
    cfg: ServiceSubagentConfig;
    connectedServices: SubagentService[];
  },
): ConfigBlob {
  const layout = buildServiceSubagentEntries(args);
  const list = (cfg.agents?.list ?? []) as Array<Record<string, unknown>>;
  const findOrCreate = (id: string) => {
    const existing = list.find((a) => a.id === id);
    if (existing) return existing;
    const created: Record<string, unknown> = { id };
    list.push(created);
    return created;
  };

  // Primary
  const primary = findOrCreate(layout.primary.id);
  primary.subagents = {
    ...((primary.subagents as Record<string, unknown>) ?? {}),
    allowAgents: layout.primary.subagentsAllow,
  };
  const primaryTools =
    (primary.tools as Record<string, unknown>) ?? (primary.tools = {});
  const primaryDeny = new Set<string>([
    ...(((primaryTools as Record<string, unknown>).deny as string[]) ?? []),
    ...layout.primary.toolsDeny,
  ]);
  (primaryTools as Record<string, unknown>).deny = [...primaryDeny];

  // Subagents
  for (const sub of layout.subagents) {
    const entry = findOrCreate(sub.id);
    const tools = (entry.tools as Record<string, unknown>) ?? (entry.tools = {});
    (tools as Record<string, unknown>).allow = sub.toolsAllow;
    (tools as Record<string, unknown>).deny = sub.toolsDeny;
  }

  // Drop subagent entries for services that are no longer connected. We
  // keep this conservative: only delete entries whose ID matches our
  // naming convention AND whose service is NOT in connectedServices.
  const wantedSubagentIds = new Set(
    args.connectedServices.map((s) => subagentIdFor(args.cfg.safeAgentId, s)),
  );
  for (let i = list.length - 1; i >= 0; i--) {
    const id = list[i]?.id as string | undefined;
    if (!id || !id.startsWith(`${args.cfg.safeAgentId}-`)) continue;
    if (id === args.cfg.parentAgentId) continue;
    const tail = id.slice(args.cfg.safeAgentId.length + 1);
    if (
      (SUBAGENT_SERVICES as readonly string[]).includes(tail) &&
      !wantedSubagentIds.has(id)
    ) {
      list.splice(i, 1);
    }
  }

  if (cfg.agents) {
    (cfg.agents as Record<string, unknown>).list = list;
  }
  return cfg;
}
