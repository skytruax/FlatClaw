/**
 * Write the current inference settings into every gateway this portal runs,
 * over RPC (the gateways stay up; a provider change hot-reloads). The
 * supervisor does the same offline before each per-user gateway starts, so a
 * gateway that was down when the admin saved still comes up with the new
 * values.
 */
import { listGatewayHandles } from "@/lib/gateways/registry";
import { readGatewayConfig, writeGatewayConfig } from "@/lib/openclaw/gateway-config";
import { applyInferenceSettings, readInferenceSettings } from "./inference";

export async function pushInferenceSettings(): Promise<{ updated: Array<string | null>; failed: Array<{ agentId: string | null; error: string }> }> {
  const settings = readInferenceSettings();
  const updated: Array<string | null> = [];
  const failed: Array<{ agentId: string | null; error: string }> = [];
  for (const handle of await listGatewayHandles()) {
    try {
      const snapshot = await readGatewayConfig(handle.client);
      applyInferenceSettings(snapshot.blob, settings);
      if (await writeGatewayConfig(snapshot, handle.client)) updated.push(handle.agentId);
    } catch (err) {
      failed.push({ agentId: handle.agentId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { updated, failed };
}
