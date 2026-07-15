/**
 * Provision per-(user, service) subagent identities (Phase D activation).
 *
 * For each connected service the user has credentials for, mint a focused
 * subagent in the gateway via `agents.create`, write a terse SOUL.md, and
 * apply the policy layout that:
 *   - denies the primary agent the service's MCP prefix (forcing
 *     dispatch through `sessions_spawn`)
 *   - allows the subagent only its own service's MCP prefix + workspace
 *     primitives
 *
 * Idempotent. Activated when `FLATCLAW_SERVICE_SUBAGENTS=1` is set.
 */
import { homedir } from "node:os";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getGatewayClient } from "@/lib/openclaw/adapter";
import {
  SUBAGENT_SERVICES,
  type SubagentService,
  applyServiceSubagentLayout,
  buildServiceSubagentSoul,
  subagentIdFor,
} from "@/lib/openclaw/service-subagents";
import { listManagedMcpServices } from "@/lib/openclaw/managed-mcp";
import "@/lib/openclaw/services"; // populate the registry (plugin side effects)
import type { ConfigBlob } from "@/lib/openclaw/agent-tool-policy";

interface ConfigGetResult {
  blob?: ConfigBlob;
  hash?: string;
}

/**
 * Returns true if subagents are activated for this deployment. Gated
 * behind an env var so the rollout is opt-in until UI nesting + ops
 * burden is acceptable. Defaults off.
 */
export function subagentsEnabled(): boolean {
  return process.env.FLATCLAW_SERVICE_SUBAGENTS === "1";
}

/**
 * Detect which services the user has credentials for, via the plugin
 * registry (no hardcoded service list — a service absent from this build
 * simply never registers and never connects). Subagents are minted only
 * for connected services in the subagent-supported set.
 */
async function detectConnectedServices(
  userId: string,
): Promise<SubagentService[]> {
  const supported = listManagedMcpServices().filter((svc) =>
    (SUBAGENT_SERVICES as readonly string[]).includes(svc.service),
  );
  const checks = await Promise.all(
    supported.map(async (svc) => {
      try {
        return (await svc.readStatus(userId)).connected
          ? (svc.service as SubagentService)
          : null;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter((s): s is SubagentService => s != null);
}

/** Display label for a service, from its registry descriptor. */
function serviceLabel(service: SubagentService): string {
  return listManagedMcpServices().find((s) => s.service === service)?.label ?? service;
}

/**
 * Provision (or reconcile) the per-service subagents for a user. Creates
 * agents that don't yet exist, updates SOUL.md on existing ones, applies
 * the policy layout to the openclaw config in one config.set round-trip.
 *
 * Returns the list of (subagentId, service) tuples now in place.
 */
export async function provisionServiceSubagentsForUser(
  userId: string,
): Promise<Array<{ subagentId: string; service: SubagentService }>> {
  if (!subagentsEnabled()) {
    return [];
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user || !user.agentId) {
    throw new Error(`user ${userId} has no agent — provision the primary first`);
  }
  const safeAgentId = user.agentId;
  const parentIdentityName = user.identityName ?? user.email ?? safeAgentId;

  const connected = await detectConnectedServices(userId);
  if (connected.length === 0) return [];

  const client = getGatewayClient();
  const result: Array<{ subagentId: string; service: SubagentService }> = [];

  for (const service of connected) {
    const subagentId = subagentIdFor(safeAgentId, service);
    const workspace = `${homedir()}/.openclaw/workspace-${subagentId}`;
    const createPayload: Record<string, unknown> = {
      name: subagentId,
      workspace,
    };
    try {
      await client.call("agents.create", createPayload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("already exists")) {
        console.warn(`[subagent] ${subagentId} create failed:`, msg);
        continue;
      }
    }
    // Wait for the gateway reload settled before piling on file writes.
    await client.waitUntilReady();
    // Write the focused SOUL.md.
    const soul = buildServiceSubagentSoul({
      service,
      parentIdentityName,
      serviceLabel: serviceLabel(service),
      agentId: subagentId,
    });
    try {
      await client.call("agents.files.set", {
        agentId: subagentId,
        name: "SOUL.md",
        content: soul,
      });
    } catch (err) {
      console.warn(`[subagent] ${subagentId} SOUL.md write failed:`, err);
    }
    result.push({ subagentId, service });
  }

  // Apply the layout (deny on primary, allow on subagents) in a single
  // config.set. Read-modify-write with the gateway's optimistic-concurrency
  // baseHash so a parallel write fails loud rather than racing.
  const cfgResult = (await client.call("config.get", {})) as ConfigGetResult;
  if (!cfgResult.blob) {
    throw new Error("config.get returned no blob");
  }
  applyServiceSubagentLayout(cfgResult.blob, {
    cfg: {
      parentAgentId: safeAgentId,
      safeAgentId,
      identityName: parentIdentityName,
    },
    connectedServices: connected,
  });
  await client.call("config.set", {
    raw: JSON.stringify(cfgResult.blob, null, 2),
    baseHash: cfgResult.hash,
  });
  await client.waitUntilReady();

  return result;
}

/**
 * Run provisionServiceSubagentsForUser across every user that has an
 * agent. Used by the backfill script + by ops when activation is first
 * flipped on.
 */
export async function provisionServiceSubagentsForAllUsers(): Promise<void> {
  if (!subagentsEnabled()) {
    console.log(
      "[subagent] FLATCLAW_SERVICE_SUBAGENTS!=1 — skipping subagent provisioning",
    );
    return;
  }
  const users = await db.select().from(schema.users);
  for (const u of users) {
    if (!u.agentId) continue;
    try {
      const result = await provisionServiceSubagentsForUser(u.id);
      console.log(
        `[subagent] ${u.email}: provisioned ${result.length} subagents (${result.map((r) => r.service).join(", ")})`,
      );
    } catch (err) {
      console.warn(`[subagent] ${u.email} failed:`, err);
    }
  }
}

/** Re-export the service list for convenience. */
export { SUBAGENT_SERVICES };
