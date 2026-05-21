import { getGatewayClient } from "./adapter";
import {
  buildToolsMd,
  buildAgentsMd,
  readEffectiveSkillAllowlist,
} from "./skills";
import { buildSoul } from "./agent-mapper";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { readServiceOauthStatus } from "@/lib/credentials/oauth";
import { readCpanelStatus } from "@/lib/credentials/cpanel";
import { cpanelServerNameForAgent } from "./cpanel-mcp";
import { managedServerName } from "./agent-tool-policy";
import { listManagedMcpServices } from "./managed-mcp";
import "./services"; // populate the managed-MCP registry (plugin side effects)

/**
 * Rewrite the per-user agent's SOUL.md / AGENTS.md / TOOLS.md so they
 * reflect current state:
 *
 *   - the tenant skill allowlist (read live from openclaw config — set by
 *     `tenant-skills.ts` materialization)
 *   - the user's google OAuth status (drives whether the gog MCP tools
 *     are mentioned in the prompt)
 *   - the user's cpanel vault status (drives whether the cpanel MCP tools
 *     are mentioned in the prompt)
 *
 * Idempotent. Doesn't write any openclaw config — only the three workspace
 * files for this agent. The skill allowlist is owned by `tenant-skills.ts`
 * and the per-user MCPs by `managed-mcp.ts`.
 */
export async function syncSkillsForUser(
  userId: string,
): Promise<{ agentId: string; skillIds: string[] } | null> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (rows.length === 0 || !rows[0].agentId) return null;
  const u = rows[0];
  const agentId = u.agentId!;

  // Google account email + per-user MCP server name. The MCP server name
  // is what the agent calls (e.g. `google-skyler-truax-gmail-com__gmail_search`);
  // the email is informational only.
  const googleStatus = await readServiceOauthStatus(userId, "google");
  const googlePrefix = "google-";
  const googleMcpServerName = googleStatus.connected
    ? managedServerName(googlePrefix, agentId)
    : null;
  const googleEmail = googleStatus.connected
    ? googleStatus.identity ?? null
    : null;

  // Source of truth for "which skills can this agent see": openclaw's live
  // config (agents.list[i].skills if explicit, else agents.defaults.skills).
  // The tenant allowlist materializer keeps that in sync with our portal DB.
  const skillIds = await readEffectiveSkillAllowlist(agentId);

  // Per-user cpanel MCP wiring: only mention the cpanel tool family in
  // AGENTS.md/TOOLS.md when this user has creds in the vault.
  const cpStatus = await readCpanelStatus(userId);
  const cpanelMcpServerName = cpStatus.connected
    ? cpanelServerNameForAgent(agentId)
    : null;
  const cpanelUsername = cpStatus.username;

  const client = getGatewayClient();
  const identityName = u.identityName ?? u.email;
  // catalogMode steers TOOLS.md scaffolding. Currently always false —
  // the wrapper exposes _help/_describe alongside real tools in verbose
  // mode (the default everywhere), so the model calls real tools by
  // name and the cookbook should teach that pattern, not the catalog
  // 3-step dance. Re-enable per-MCP if a model ever does run in catalog
  // mode (FLATCLAW_<SVC>_MCP_MODE=catalog).
  const catalogMode = false;
  const subagentsMode = process.env.FLATCLAW_SERVICE_SUBAGENTS === "1";

  // Generic per-service prompt sections: any registered managed-MCP plugin
  // can fold AGENTS.md / TOOLS.md bullets in via its buildAgentsSection /
  // buildToolsSection hooks (when the user has it connected). Keeps this file
  // free of any specific service name — private add-ons drop in through the
  // plugin registry. Skipped in subagent mode (subagents get schemas direct).
  const extraAgentsSections: string[] = [];
  const extraToolsSections: string[] = [];
  if (!subagentsMode) {
    for (const svc of listManagedMcpServices()) {
      if (!svc.buildAgentsSection && !svc.buildToolsSection) continue;
      const ctx = {
        userId,
        agentId,
        serverName: managedServerName(svc.prefix, agentId),
      };
      if (svc.buildAgentsSection) {
        const s = await svc.buildAgentsSection(ctx);
        if (s) extraAgentsSections.push(s);
      }
      if (svc.buildToolsSection) {
        const s = await svc.buildToolsSection(ctx);
        if (s) extraToolsSections.push(s);
      }
    }
  }

  const agents = buildAgentsMd({
    identityName,
    email: u.email,
    agentId,
    enabledSkillIds: skillIds,
    cpanelMcpServerName,
    cpanelUsername,
    googleMcpServerName,
    googleEmail,
    extraServiceSections: extraAgentsSections,
    subagentsMode,
  });
  const tools = buildToolsMd({
    identityName,
    agentId,
    enabledSkillIds: skillIds,
    cpanelMcpServerName,
    cpanelUsername,
    googleMcpServerName,
    googleEmail,
    extraServiceSections: extraToolsSections,
    catalogMode,
    subagentsMode,
  });
  // SOUL is rewritten too — keeping this in lockstep with buildSoul() means
  // a Sync click repairs any agent whose SOUL was generated under stale
  // model assumptions or template versions.
  const soul = buildSoul({
    identityName,
    email: u.email,
    agentId,
    modelId: "current", // value is unused — kept for signature compat
  });
  await client.call("agents.files.set", {
    agentId,
    name: "SOUL.md",
    content: soul,
  });
  await client.call("agents.files.set", {
    agentId,
    name: "AGENTS.md",
    content: agents,
  });
  await client.call("agents.files.set", {
    agentId,
    name: "TOOLS.md",
    content: tools,
  });

  // Seed MEMORY.md if the agent doesn't have one yet. Memory is agent-owned:
  // the agent maintains its own durable notes across sessions, and OpenClaw's
  // built-in engine indexes MEMORY.md + memory/*.md for keyword (and, once an
  // embedding provider is wired in v0.3, semantic) recall. We only write the
  // starter when the file is ABSENT — never on every sync — so we never
  // clobber what the agent has written. This makes a non-empty MEMORY.md part
  // of agent creation, Sync, and the backfill (all route through here).
  await seedMemoryFileIfAbsent(client, agentId, identityName);

  // Subagent provisioning (Phase D activation, gated by env). Idempotent.
  if (subagentsMode) {
    const { provisionServiceSubagentsForUser } = await import(
      "./provision-service-subagents"
    );
    try {
      const result = await provisionServiceSubagentsForUser(u.id);
      if (result.length > 0) {
        console.log(
          `[sync-skills] provisioned ${result.length} subagents for ${u.email}: ${result.map((r) => r.service).join(", ")}`,
        );
      }
    } catch (err) {
      console.warn(`[sync-skills] subagent provisioning failed for ${u.email}:`, err);
    }
  }

  return { agentId, skillIds };
}

/**
 * Minimal starter MEMORY.md seeded into an agent's workspace. The agent
 * maintains it thereafter; we never overwrite a non-empty one.
 */
function buildMemoryMd(identityName: string): string {
  return `# Memory

Durable notes ${identityName} keeps across sessions — user preferences,
recurring context, and behavior guidance. ${identityName} maintains this file
itself during normal turns; entries are optional and can be edited or removed
freely.

OpenClaw's built-in memory engine indexes this file (and anything under
\`memory/\`) for recall.

<!-- Add durable facts below, one per line. For example:
- The user prefers concise, numerate answers.
- Primary project: <name> — <one-line context>.
-->
`;
}

/**
 * Write the starter MEMORY.md only when the agent has none. Idempotent: a
 * non-empty MEMORY.md is left untouched so agent-written memory survives a
 * Sync or backfill. Routed through syncSkillsForUser, so agent creation, the
 * Sync button, and backfill-agents.ts all guarantee a memory file exists.
 */
async function seedMemoryFileIfAbsent(
  client: Awaited<ReturnType<typeof getGatewayClient>>,
  agentId: string,
  identityName: string,
): Promise<void> {
  try {
    const res = (await client.call("agents.files.get", {
      agentId,
      name: "MEMORY.md",
    })) as { file?: { missing?: boolean; content?: string } };
    const file = res?.file;
    const present =
      !!file && file.missing !== true && (file.content ?? "").trim().length > 0;
    if (present) return;
  } catch {
    // agents.files.get errors when the file is missing — fall through to seed.
  }
  await client.call("agents.files.set", {
    agentId,
    name: "MEMORY.md",
    content: buildMemoryMd(identityName),
  });
}
