/**
 * The agent roster inside openclaw.json, and the config-document types the
 * portal's writers share. Pure functions — no gateway I/O (see
 * gateway-config.ts for that).
 *
 * The roster changed shape upstream:
 *
 *   openclaw ≤ 2026.7   agents.list    = [{ id, ...entry }, …]
 *   openclaw ≥ 2026.8   agents.entries = { <id>: { ...entry }, … }
 *                       + agents.ownership = "explicit" on any roster with
 *                         more than one agent
 *
 * The 2026.9 schema is strict: `agents.list` is not a valid key any more
 * (Doctor migrates it), an entry carries no `id` of its own, and a multi-agent
 * roster without `ownership: "explicit"` fails validation. Every portal writer
 * goes through the helpers below so none of them has to know that.
 *
 * Two rules the gateway enforces on a full-document `config.set`:
 *   - a write may not drop an existing agent ("config.set would remove existing
 *     agent entries … use the agents.delete RPC") — so never build a write from
 *     a roster you failed to read;
 *   - agents are added with the `agents.create` RPC, which also creates the
 *     workspace. `ensureAgentEntry` exists for attaching policy to an agent
 *     that is already there.
 */

export interface ToolPolicy {
  allow?: string[];
  alsoAllow?: string[];
  deny?: string[];
  profile?: string;
  [k: string]: unknown;
}

export interface AgentEntry {
  tools?: ToolPolicy;
  skills?: string[];
  subagents?: { allowAgents?: string[]; [k: string]: unknown };
  [k: string]: unknown;
}

export interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: string;
  headers?: Record<string, string>;
  [k: string]: unknown;
}

export interface ConfigBlob {
  agents?: {
    ownership?: "explicit";
    defaults?: Record<string, unknown>;
    entries?: Record<string, AgentEntry>;
    [k: string]: unknown;
  };
  mcp?: { servers?: Record<string, McpServerEntry>; [k: string]: unknown };
  [k: string]: unknown;
}

/**
 * Bring a config document to the current roster shape, in place. A no-op on a
 * document that already uses `agents.entries`; converts a pre-2026.8
 * `agents.list` the same way the gateway's own migration does (entry minus
 * `id`, keyed by `id`).
 */
export function normalizeAgentRoster(cfg: ConfigBlob): void {
  const agents = cfg.agents as
    | (NonNullable<ConfigBlob["agents"]> & { list?: unknown })
    | undefined;
  if (!agents || !Array.isArray(agents.list)) return;
  const entries: Record<string, AgentEntry> = { ...(agents.entries ?? {}) };
  for (const item of agents.list) {
    if (!item || typeof item !== "object") continue;
    const { id, ...entry } = item as { id?: unknown } & AgentEntry;
    if (typeof id !== "string" || !id) continue;
    if (!(id in entries)) entries[id] = entry;
  }
  delete agents.list;
  agents.entries = entries;
  markRosterOwnership(cfg);
}

/** A multi-agent roster must say `ownership: "explicit"` or it fails validation. */
function markRosterOwnership(cfg: ConfigBlob): void {
  const agents = cfg.agents;
  if (!agents?.entries) return;
  if (Object.keys(agents.entries).length > 1 && agents.ownership !== "explicit") {
    agents.ownership = "explicit";
  }
}

/** The roster map (agent id → entry), created empty when the document has none. */
export function agentEntries(cfg: ConfigBlob): Record<string, AgentEntry> {
  normalizeAgentRoster(cfg);
  cfg.agents = cfg.agents ?? {};
  cfg.agents.entries = cfg.agents.entries ?? {};
  return cfg.agents.entries;
}

/** Agent ids in roster order. */
export function listAgentIds(cfg: ConfigBlob): string[] {
  normalizeAgentRoster(cfg);
  return Object.keys(cfg.agents?.entries ?? {});
}

export function findAgentEntry(
  cfg: ConfigBlob,
  agentId: string,
): AgentEntry | undefined {
  normalizeAgentRoster(cfg);
  return cfg.agents?.entries?.[agentId];
}

/**
 * The entry for an agent, added (empty) when the roster lacks it. Use for
 * attaching policy to an agent the gateway already knows — creating a brand-new
 * agent is `agents.create`'s job.
 */
export function ensureAgentEntry(cfg: ConfigBlob, agentId: string): AgentEntry {
  const entries = agentEntries(cfg);
  if (!entries[agentId]) {
    entries[agentId] = {};
    markRosterOwnership(cfg);
  }
  return entries[agentId];
}
