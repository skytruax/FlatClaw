/**
 * Per-agent tool policy computation.
 *
 * openclaw's `agents.entries.<id>.tools.deny` is a glob-pattern array processed
 * by `applyToolPolicyPipeline` *before* the model sees its tool roster. We use
 * it to enforce per-user MCP visibility: every agent denies the
 * `<server>__*` patterns for MCP servers that belong to *other* users.
 *
 * openclaw's embedded runner exposes MCP tools as
 * `<safeServerName>__<toolName>` — no `mcp__` prefix, hyphens preserved
 * (see openclaw/src/agents/agent-bundle-mcp-names.ts). Claude Desktop / CLI
 * adds `mcp__` on its side; the embedded runtime FlatClaw runs against
 * never does.
 *
 * Server ownership is encoded by naming convention:
 *
 *   cpanel-<safeAgentId>     ← owned by the agent whose ID, when normalized
 *   caldav-<safeAgentId>       via `safeAgentId()`, equals <safeAgentId>
 *
 * with one hard limit: the gateway only keeps the first 30 characters of a
 * server name when it builds tool names, so `managedServerName()` never
 * returns more than 30 (a long agent id is shortened and tagged with a hash).
 * A longer name would be exposed under a prefix no deny glob matches — which
 * is how every agent came to see the tools of users with long email
 * addresses before this was fixed.
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
 * The roster itself (`agents.entries`, keyed by agent id since openclaw
 * 2026.8) is read through agent-roster.ts.
 *
 * See docs/mcp-auth-plan.md §4e for the full design.
 */

import { createHash } from "node:crypto";
import { agentEntries, type ConfigBlob } from "./agent-roster";

export type { ConfigBlob } from "./agent-roster";

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
 * `agent-bundle-mcp-names.ts` — `TOOL_NAME_SEPARATOR = "__"`). No `mcp__`
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

/**
 * How OpenClaw turns MCP servers into tool names
 * (openclaw/src/agents/agent-bundle-mcp-names.ts):
 *
 *   <server name, cut to TOOL_NAME_MAX_PREFIX = 30 chars>__<tool name>
 *   …and the whole thing cut to TOOL_NAME_MAX_TOTAL = 64 chars.
 *
 * Everything FlatClaw writes into a deny list has to be the name the gateway
 * will actually use, not the name we would have liked.
 */
export const GATEWAY_SERVER_NAME_MAX = 30;
export const GATEWAY_TOOL_NAME_MAX = 64;
const TOOL_NAME_SEPARATOR = "__";

/** The server-name part of the tool names the gateway exposes for `serverName`. */
export function gatewayServerPrefix(serverName: string): string {
  return serverName.slice(0, GATEWAY_SERVER_NAME_MAX);
}

/** The tool name the gateway exposes for one tool of one server. */
export function gatewayToolName(serverName: string, toolName: string): string {
  const prefix = gatewayServerPrefix(serverName);
  const room = Math.max(1, GATEWAY_TOOL_NAME_MAX - prefix.length - TOOL_NAME_SEPARATOR.length);
  return `${prefix}${TOOL_NAME_SEPARATOR}${toolName.slice(0, room)}`;
}

/** Whether a server name follows one of the registered managed prefixes. */
function isManagedServerName(name: string): boolean {
  for (const prefix of managedPrefixes) {
    if (name.startsWith(prefix) && name.length > prefix.length) return true;
  }
  return false;
}

/**
 * The server name FlatClaw used before the 30-character limit was handled:
 * the prefix plus the whole agent id, however long. Kept so stale entries can
 * be found and replaced (see `legacyManagedServerNames`).
 */
export function legacyManagedServerName(prefix: string, agentId: string): string {
  return `${prefix}${safeAgentId(agentId)}`;
}

/**
 * The MCP server name that belongs to a given agent, for a given service.
 *
 * `<prefix><safeAgentId>` when that fits the gateway's 30 characters — which
 * keeps every existing short name unchanged. Otherwise the agent id is cut
 * and suffixed with 8 hex characters of its SHA-256, so the result is exactly
 * as unique as the id it came from and still readable in logs:
 *
 *   google- + nate-kirktechsolutions-com  →  google-nate-kirktech-3f9a1c2e
 */
export function managedServerName(prefix: string, agentId: string): string {
  const safe = safeAgentId(agentId);
  const full = `${prefix}${safe}`;
  if (full.length <= GATEWAY_SERVER_NAME_MAX) return full;
  const digest = createHash("sha256").update(safe).digest("hex").slice(0, 8);
  const room = GATEWAY_SERVER_NAME_MAX - prefix.length - digest.length - 1;
  const head = safe.slice(0, Math.max(0, room)).replace(/-+$/, "");
  return head ? `${prefix}${head}-${digest}` : `${prefix}${digest}`;
}

/** Every managed server name that belongs to an agent, current and legacy. */
function ownedServerNames(agentId: string): Set<string> {
  const names = new Set<string>();
  for (const prefix of managedPrefixes) {
    names.add(managedServerName(prefix, agentId));
    names.add(legacyManagedServerName(prefix, agentId));
  }
  return names;
}

/**
 * Entries in `mcp.servers` that still use an agent's over-long legacy name.
 * The caller replaces them: re-register the server under `managedServerName`
 * and delete the legacy key.
 */
export function legacyManagedServerNames(cfg: ConfigBlob, agentId: string): string[] {
  const servers = cfg.mcp?.servers ?? {};
  const stale: string[] = [];
  for (const prefix of managedPrefixes) {
    const legacy = legacyManagedServerName(prefix, agentId);
    if (legacy !== managedServerName(prefix, agentId) && legacy in servers) stale.push(legacy);
  }
  return stale;
}

/**
 * The deny-list glob pattern that hides every tool exposed by a server name.
 * openclaw flattens MCP tool names to `<safeServerName>__<toolName>`, where
 * the server part is at most 30 characters — so the pattern is built from the
 * prefix the gateway uses, which also covers a name we did not shorten
 * ourselves (a legacy entry, or a hand-registered third-party server).
 */
export function denyPatternForServer(name: string): string {
  return `${gatewayServerPrefix(name)}${TOOL_NAME_SEPARATOR}*`;
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
  const own = ownedServerNames(agentId);
  const shared = opts?.sharedServerNames ?? new Set<string>();
  const out = new Set<string>();
  for (const name of managedServerNames) {
    if (shared.has(name)) continue;
    if (!isManagedServerName(name)) continue;
    if (own.has(name)) continue; // own server stays visible
    out.add(denyPatternForServer(name));
  }
  return [...out].sort();
}

/**
 * Mutates `cfg` in place. For each agent in the roster (`cfg.agents.entries`),
 * replace the managed deny-list patterns (those matching `cpanel-*__*` /
 * `caldav-*__*` etc — anything whose server name starts with a registered
 * managed prefix) with the freshly-computed set. Preserves all other fields
 * and any operator-authored deny patterns.
 *
 * Returns the list of agent IDs whose tools.deny actually changed (for
 * audit log + minimizing config.set thrash on noop calls).
 */
export function applyManagedToolPolicies(
  cfg: ConfigBlob,
  opts?: ComputeOpts,
): { changedAgents: string[] } {
  const allServerNames = Object.keys(cfg.mcp?.servers ?? {});
  const managedNames = allServerNames.filter(isManagedServerName);

  const changed: string[] = [];

  for (const [id, entry] of Object.entries(agentEntries(cfg))) {
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
