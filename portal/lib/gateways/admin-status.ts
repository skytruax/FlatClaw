/**
 * What the admin pages show about gateways: for each one, the registry row,
 * the supervisor's process state, and whether it answers RPC.
 */
import type { GatewayRow } from "@/components/admin/GatewayCell";
import { gatewayMode } from "./paths";
import { listGatewayHandles, type GatewayHandle } from "./registry";
import { gatewayProcessStatus } from "./supervisor";

export interface GatewayAgent {
  id: string;
  name?: string;
  identity?: { emoji?: string; avatar?: string };
}
interface AgentsListResult {
  agents?: GatewayAgent[];
  defaultId?: string;
  mainKey?: string;
}

export interface GatewaysOverview {
  perUser: boolean;
  /** Every agent on every gateway this portal reaches. */
  agents: GatewayAgent[];
  /** The shared gateway's default agent (shared mode only). */
  defaultAgentId?: string;
  /** Per-user gateways (empty in shared mode). */
  gateways: GatewayRow[];
}

async function probe(handle: GatewayHandle): Promise<AgentsListResult> {
  await handle.client.call("models.list", {}, 4_000);
  return handle.client.call<AgentsListResult>("agents.list", {}, 4_000);
}

/**
 * In shared mode a gateway that does not answer throws (the page shows the
 * reconnect banner as before). In per-user mode each gateway is reported on
 * its own row and never takes the page down.
 */
export async function gatewaysOverview(): Promise<GatewaysOverview> {
  const perUser = gatewayMode() === "per-user";
  const agents: GatewayAgent[] = [];
  const gateways: GatewayRow[] = [];
  let defaultAgentId: string | undefined;
  for (const handle of await listGatewayHandles()) {
    if (!handle.record) {
      const r = await probe(handle);
      agents.push(...(r.agents ?? []));
      defaultAgentId = r.defaultId;
      continue;
    }
    const proc = gatewayProcessStatus(handle.record.agentId);
    const row: GatewayRow = {
      agentId: handle.record.agentId,
      port: handle.record.port,
      unixUser: handle.record.unixUser,
      ...proc,
      reachable: false,
      error: null,
    };
    if (proc.state === "running") {
      try {
        const r = await probe(handle);
        agents.push(...(r.agents ?? []));
        row.reachable = true;
      } catch (err) {
        row.error = err instanceof Error ? err.message : String(err);
      }
    }
    gateways.push(row);
  }
  return { perUser, agents, defaultAgentId, gateways };
}
