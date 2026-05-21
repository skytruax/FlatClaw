import { getGatewayClient } from "./adapter";
import {
  applyManagedToolPolicies,
  isManagedDenyPattern,
  safeAgentId,
  type ConfigBlob,
} from "./agent-tool-policy";
import { listManagedMcpServices } from "./managed-mcp";

/**
 * Per-user (per-agent) tool access, surfaced in the admin portal.
 *
 * Leans entirely on OpenClaw's BUILT-IN tool policy: an agent's
 * `agents.list[].tools.deny` is applied by the gateway before the model ever
 * sees its tool roster (deny wins; denied tools are filtered out, not
 * runtime-blocked). No custom policy plugin, endpoint, or table.
 *
 * The toggle catalog is assembled generically:
 *   - Built-in + plugin tools come from the gateway's `tools.catalog` RPC
 *     (the authoritative live catalog — every core/plugin group with real
 *     tool ids, labels, descriptions).
 *   - MCP tools come from each connected managed service's declared tool
 *     inventory (`toolGroups`).
 *
 * Two kinds of deny entries coexist on one agent:
 *   - MANAGED globs (`<prefix><otherAgent>__*`) — auto-computed cross-user MCP
 *     isolation, owned by `applyManagedToolPolicies`. Not editable here.
 *   - OPERATOR denies — individual tool ids an admin disabled for this user.
 *     Editable here. We only ever rewrite the operator set.
 */

interface ConfigGetResult {
  config: ConfigBlob | string;
  hash?: string;
  baseHash?: string;
  raw?: string;
}

function readBlob(value: unknown): ConfigBlob {
  if (typeof value === "string") return JSON.parse(value) as ConfigBlob;
  return (value as ConfigBlob) ?? {};
}

interface CatalogTool {
  id: string;
  label?: string;
  description?: string;
}
interface CatalogGroup {
  id: string;
  label?: string;
  source?: string;
  tools?: CatalogTool[];
}
interface CatalogResult {
  groups?: CatalogGroup[];
}

export interface ToolEntry {
  /** Tool id written to `tools.deny` when denied (built-in id or `<server>__<tool>`). */
  id: string;
  label: string;
  description?: string;
}

export interface ToolSection {
  key: string;
  label: string;
  /** "core" | "plugin" | "mcp" — for grouping/labelling in the UI. */
  source: string;
  tools: ToolEntry[];
}

export interface AgentToolAccess {
  agentId: string;
  exists: boolean;
  /** Operator-authored deny entries currently set. */
  denied: string[];
  sections: ToolSection[];
}

function findAgentEntry(blob: ConfigBlob, agentId: string) {
  return (blob.agents?.list ?? []).find((e) => e.id === agentId);
}

/** Built-in + plugin tool groups, straight from the live gateway catalog. */
async function builtinSections(agentId: string): Promise<ToolSection[]> {
  const client = getGatewayClient();
  let cat: CatalogResult;
  try {
    cat = (await client.call("tools.catalog", { agentId })) as CatalogResult;
  } catch {
    return [];
  }
  const out: ToolSection[] = [];
  for (const g of cat.groups ?? []) {
    const tools = (g.tools ?? []).map((t) => ({
      id: t.id,
      label: t.label ?? t.id,
      description: t.description,
    }));
    if (tools.length === 0) continue;
    out.push({
      key: `group:${g.id}`,
      label: g.label ?? g.id,
      source: g.source ?? "core",
      tools,
    });
  }
  return out;
}

/** MCP tool inventory for the user's connected managed servers. */
function mcpSections(blob: ConfigBlob, agentId: string): ToolSection[] {
  const safe = safeAgentId(agentId);
  const servers = blob.mcp?.servers ?? {};
  const managed = listManagedMcpServices();
  const out: ToolSection[] = [];
  for (const serverName of Object.keys(servers)) {
    const svc = managed.find((s) => serverName === `${s.prefix}${safe}`);
    if (!svc?.toolGroups?.length) continue;
    // One collapsible section per service tool-group (keeps large services like
    // Google rolled up into Gmail / Calendar / Drive / … rather than one huge list).
    for (const g of svc.toolGroups) {
      const tools = g.tools.map((t) => ({
        id: `${serverName}__${t}`,
        label: t,
        description: g.description,
      }));
      if (tools.length)
        out.push({ key: `${serverName}::${g.id}`, label: g.label, source: svc.service, tools });
    }
  }
  return out;
}

export async function readAgentToolAccess(agentId: string): Promise<AgentToolAccess> {
  const client = getGatewayClient();
  const cur = (await client.call("config.get", {})) as ConfigGetResult;
  const blob = readBlob(cur.config ?? cur.raw);

  const entry = findAgentEntry(blob, agentId);
  const allDeny = Array.isArray(entry?.tools?.deny)
    ? (entry!.tools!.deny as string[])
    : [];
  const denied = allDeny.filter((d) => !isManagedDenyPattern(d));

  const sections = [...(await builtinSections(agentId)), ...mcpSections(blob, agentId)];

  return { agentId, exists: Boolean(entry), denied, sections };
}

/**
 * Replace the operator-authored deny set for one agent. `denied` is a list of
 * individual tool ids (built-in ids or `<server>__<tool>`). Managed cross-user
 * globs are preserved/recomputed. Persists + reloads the gateway.
 */
export async function setAgentToolDeny(
  agentId: string,
  denied: string[],
): Promise<{ changed: boolean }> {
  // Operator denies are individual tool ids — never `__*` wildcards (that's the
  // managed cross-user layer's shape).
  const clean = Array.from(new Set(denied))
    .map((d) => d.trim())
    .filter((d) => d.length > 0 && !d.endsWith("__*"));

  const client = getGatewayClient();
  const cur = (await client.call("config.get", {})) as ConfigGetResult;
  const blob = readBlob(cur.config ?? cur.raw);
  const before = JSON.stringify(blob);

  blob.agents = blob.agents ?? {};
  blob.agents.list = blob.agents.list ?? [];
  let entry = findAgentEntry(blob, agentId);
  if (!entry) {
    entry = { id: agentId };
    blob.agents.list.push(entry);
  }

  const existingDeny = Array.isArray(entry.tools?.deny)
    ? (entry.tools!.deny as string[])
    : [];
  const managed = existingDeny.filter((d) => isManagedDenyPattern(d));
  const nextDeny = [...managed, ...clean].sort();

  const e = entry as { tools?: { deny?: string[]; [k: string]: unknown }; [k: string]: unknown };
  if (nextDeny.length === 0) {
    if (e.tools) {
      delete e.tools.deny;
      if (Object.keys(e.tools).length === 0) delete e.tools;
    }
  } else {
    e.tools = { ...(e.tools ?? {}), deny: nextDeny };
  }

  // Recompute managed globs so this write never drifts the cross-user layer.
  applyManagedToolPolicies(blob);

  const after = JSON.stringify(blob);
  if (after === before) return { changed: false };
  await client.call("config.set", { raw: after, baseHash: cur.hash ?? cur.baseHash });
  await client.waitUntilReady();
  return { changed: true };
}
