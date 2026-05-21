/**
 * Per-agent tool policy computation.
 *
 * openclaw's `agents.list[i].tools.deny` is a glob-pattern array processed by
 * `applyToolPolicyPipeline` *before* the model sees its tool roster. We use
 * it to enforce per-user MCP visibility: every agent denies the
 * `<server>__*` patterns for MCP servers that belong to *other* users.
 *
 * openclaw's pi-embedded-runner exposes MCP tools as
 * `<safeServerName>__<toolName>` — no `mcp__` prefix, hyphens preserved
 * (see openclaw/src/agents/pi-bundle-mcp-names.ts). Claude Desktop / CLI
 * adds `mcp__` on its side; the embedded runtime FlatClaw runs against
 * never does.
 *
 * Server ownership is encoded by naming convention:
 *
 *   cpanel-<safeAgentId>     ← owned by the agent whose ID, when normalized
 *   caldav-<safeAgentId>       via `safeAgentId()`, equals <safeAgentId>
 *
 * Anything in `mcp.servers` that doesn't match these prefixes is treated as
 * unmanaged and is left visible to everyone (third-party MCPs, shared
 * resources we'll wire up explicitly later).
 *
 * The helper preserves any pre-existing `tools.deny` patterns the operator
 * set by hand — we only manage entries matching our own per-user prefixes
 * (the MANAGED_PATTERN_PREFIXES set below). Round-tripping through
 * `applyManagedToolPolicies` is idempotent.
 *
 * See docs/mcp-auth-plan.md §4e for the full design.
 */

interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  [k: string]: unknown;
}

interface ToolPolicy {
  allow?: string[];
  alsoAllow?: string[];
  deny?: string[];
  profile?: string;
  [k: string]: unknown;
}

interface AgentEntry {
  id?: string;
  tools?: ToolPolicy;
  [k: string]: unknown;
}

export interface ConfigBlob {
  agents?: { list?: AgentEntry[]; [k: string]: unknown };
  mcp?: { servers?: Record<string, McpServerEntry>; [k: string]: unknown };
  [k: string]: unknown;
}

/**
 * Registry of custom-auth MCP flows whose visibility we manage per-user.
 *
 * Every entry here means: "MCP servers named `<prefix><safeAgentId>` belong
 * to one specific user, and must be hidden from every other agent's tool
 * roster." Adding a new auth-flow service (slack, notion, hubspot, …) is
 * a one-line append here PLUS the corresponding vault credential shape
 * + provisioning function in lib/openclaw/<service>-mcp.ts.
 *
 * The contract every entry shares:
 *   - Server name format: `<prefix><safeAgentId>`
 *   - Tool names exposed: `<prefix><safeAgentId>__<tool>`
 *   - Deny pattern hides all of them: `<prefix><safeAgentId>__*`
 *   - openclaw glob-matcher (`mcp/cpanel/`-style globs) handles the rest.
 *
 * See docs/mcp-auth-plan.md §5 for the cross-service generalization story.
 */
/**
 * Registry of managed MCP server-name prefixes, populated at runtime by each
 * service plugin via `registerManagedPrefix()` (called from
 * `registerManagedMcpService()` in managed-mcp.ts). This module hardcodes NO
 * service list — public and private services alike self-register their prefix
 * when their plugin loads, so the public build carries no reference to any
 * specific service. A service whose plugin file is absent (e.g. a private
 * add-on not present on the public branch) simply never registers, and the
 * deny-pattern logic ignores it.
 */
const managedPrefixes = new Set<string>();

/** Called by managed-mcp's `registerManagedMcpService` for each service. */
export function registerManagedPrefix(prefix: string): void {
  managedPrefixes.add(prefix);
}

/** Snapshot of the currently-registered managed server-name prefixes. */
export function managedServerPrefixes(): readonly string[] {
  return Array.from(managedPrefixes);
}

/**
 * Whether a deny-list pattern is one this module owns. We only add/remove
 * patterns matching this shape; everything else (operator-written rules) is
 * preserved across rewrites.
 *
 * openclaw flattens MCP tools to `<safeServerName>__<toolName>` (see
 * `pi-bundle-mcp-names.ts` — `TOOL_NAME_SEPARATOR = "__"`). No `mcp__`
 * prefix.
 */
export function isManagedDenyPattern(pattern: string): boolean {
  return Array.from(managedPrefixes).some(
    (p) => pattern.startsWith(p) && pattern.endsWith("__*"),
  );
}

/** Convert any agent ID into the lowercase / alnum-hyphens shape used in MCP server names. */
export function safeAgentId(agentId: string): string {
  return agentId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Parse a managed server name into `{prefix, safeAgentId}` if it matches our convention. */
function parseManagedServerName(
  name: string,
): { prefix: string; safe: string } | null {
  for (const prefix of managedPrefixes) {
    if (name.startsWith(prefix)) {
      const safe = name.slice(prefix.length);
      if (safe) return { prefix, safe };
    }
  }
  return null;
}

/** The MCP server name that belongs to a given agent, for a given service. */
export function managedServerName(prefix: string, agentId: string): string {
  return `${prefix}${safeAgentId(agentId)}`;
}

/**
 * The deny-list glob pattern that hides every tool exposed by a server name.
 * openclaw flattens MCP tool names to `<safeServerName>__<toolName>`.
 */
export function denyPatternForServer(name: string): string {
  return `${name}__*`;
}

interface ComputeOpts {
  /**
   * Server names we register but should keep universally visible (e.g. shared-
   * FTP for all members of a group). Defaults to empty — every managed server
   * is treated as user-private.
   */
  sharedServerNames?: ReadonlySet<string>;
}

/**
 * For one agent, compute the managed deny-list patterns: every managed MCP
 * server name that does NOT belong to this agent.
 */
function computeManagedDenyForAgent(
  agentId: string,
  managedServerNames: readonly string[],
  opts?: ComputeOpts,
): string[] {
  const ownSafe = safeAgentId(agentId);
  const shared = opts?.sharedServerNames ?? new Set<string>();
  const out: string[] = [];
  for (const name of managedServerNames) {
    if (shared.has(name)) continue;
    const parsed = parseManagedServerName(name);
    if (!parsed) continue;
    if (parsed.safe === ownSafe) continue; // own server stays visible
    out.push(denyPatternForServer(name));
  }
  return out.sort();
}

/**
 * Mutates `cfg` in place. For each agent in `cfg.agents.list`, replace the
 * managed deny-list patterns (those matching `cpanel-*__*` / `caldav-*__*`
 * etc — anything whose server name starts with a MANAGED_SERVER_PREFIXES
 * entry) with the freshly-computed set. Preserves all other fields and any
 * operator-authored deny patterns.
 *
 * Returns the list of agent IDs whose tools.deny actually changed (for
 * audit log + minimizing config.set thrash on noop calls).
 */
export function applyManagedToolPolicies(
  cfg: ConfigBlob,
  opts?: ComputeOpts,
): { changedAgents: string[] } {
  cfg.agents = cfg.agents ?? {};
  cfg.agents.list = cfg.agents.list ?? [];

  const allServerNames = Object.keys(cfg.mcp?.servers ?? {});
  const managedNames = allServerNames.filter((n) => parseManagedServerName(n) !== null);

  const changed: string[] = [];

  for (const entry of cfg.agents.list) {
    const id = typeof entry.id === "string" ? entry.id : null;
    if (!id) continue;

    // Strip out our managed patterns; preserve everything else.
    const existingDeny = Array.isArray(entry.tools?.deny) ? entry.tools.deny : [];
    const preserved = existingDeny.filter((p) => !isManagedDenyPattern(p));

    // Compute the new managed patterns for this agent.
    const newManaged = computeManagedDenyForAgent(id, managedNames, opts);

    const nextDeny = [...preserved, ...newManaged];
    // Sort for deterministic output (so a subsequent recompute produces
    // identical bytes — important for openclaw's prompt-cache stability).
    nextDeny.sort();

    const before = JSON.stringify(existingDeny.slice().sort());
    const after = JSON.stringify(nextDeny);
    if (before === after) continue;

    if (nextDeny.length === 0) {
      // Drop the deny field entirely if it would be empty.
      if (entry.tools) {
        const { deny: _drop, ...restTools } = entry.tools;
        void _drop;
        entry.tools = restTools;
        if (Object.keys(entry.tools).length === 0) delete entry.tools;
      }
    } else {
      entry.tools = { ...(entry.tools ?? {}), deny: nextDeny };
    }
    changed.push(id);
  }

  return { changedAgents: changed };
}
