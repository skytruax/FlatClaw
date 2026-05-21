/**
 * Thin shim — the cpanel MCP is now driven by the generic plugin layer
 * (`managed-mcp.ts` + `services/cpanel.plugin.ts`). This file exists only
 * to keep the existing cpanel-specific call sites stable while we phase
 * the rest of the codebase over to `provisionManagedMcpForUser`.
 *
 * New code should call:
 *   import "@/lib/openclaw/services";  // ensures plugins are registered
 *   import { provisionManagedMcpForUser } from "@/lib/openclaw/managed-mcp";
 *   await provisionManagedMcpForUser("cpanel", userId);
 *
 * The same `cpanelServerNameForAgent(agentId)` helper is preserved for
 * `buildToolsMd` / `sync-skills.ts` callers.
 */
import "./services"; // side-effect: register all service plugins
import {
  provisionManagedMcpForUser,
  deprovisionManagedMcpForUser,
  recomputeAgentToolPolicies as recomputeImpl,
  managedMcpServerName,
  getManagedMcpService,
} from "./managed-mcp";

export interface CpanelMcpProvisionResult {
  serverName: string;
  capabilityToken: string;
}

export async function provisionCpanelMcpForUser(
  userId: string,
): Promise<CpanelMcpProvisionResult | null> {
  const r = await provisionManagedMcpForUser("cpanel", userId);
  return r ? { serverName: r.serverName, capabilityToken: r.capabilityToken } : null;
}

export async function deprovisionCpanelMcpForUser(userId: string): Promise<void> {
  await deprovisionManagedMcpForUser("cpanel", userId);
}

export const recomputeAgentToolPolicies = recomputeImpl;

export function cpanelServerNameForAgent(agentId: string): string {
  const svc = getManagedMcpService("cpanel");
  if (!svc) throw new Error("cpanel service plugin not loaded");
  return managedMcpServerName(svc, agentId);
}
