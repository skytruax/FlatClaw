import { getGatewayClient, type OpenClawClient } from "./adapter";
import { gatewayMode } from "@/lib/gateways/paths";
import { gatewayClientFor } from "@/lib/gateways/registry";

/** The client for an agent: the one given, else the agent's own gateway (the shared one in shared mode). */
async function clientFor(agentId: string, client?: OpenClawClient): Promise<OpenClawClient> {
  if (client) return client;
  return gatewayMode() === "shared" ? getGatewayClient() : gatewayClientFor(agentId);
}

/**
 * Removing an agent from the gateway.
 *
 * Since openclaw 2026.8 `agents.delete` is journaled: it drops the roster
 * entry, purges the agent's sessions, and moves its workspace, agent dir and
 * databases to the trash (`~/.Trash`). It does not throw when one of those
 * steps fails — it answers `ok` and lists the paths it could not remove. An
 * agent left in that state is half-deleted: its id cannot be created again
 * ("deletion cleanup is still pending") until `agents.delete` is called again
 * and finishes. So the result has to be read, not just awaited.
 */

interface AgentsDeleteResult {
  failed?: Array<{ path: string; reason: string }>;
  purgeFailed?: boolean;
}

/**
 * Delete an agent and everything it owns on the gateway. Resolves "absent"
 * when the gateway does not know the agent (already the desired end state).
 * Throws when the gateway reports the deletion as incomplete; calling again
 * retries the unfinished clean-up.
 */
export async function deleteGatewayAgent(
  agentId: string,
  gatewayClient?: OpenClawClient,
): Promise<"deleted" | "absent"> {
  const client = await clientFor(agentId, gatewayClient);
  let result: AgentsDeleteResult | undefined;
  try {
    result = (await client.call(
      "agents.delete",
      { agentId, deleteFiles: true },
      60_000,
    )) as AgentsDeleteResult | undefined;
  } catch (err) {
    if (/not found/i.test(err instanceof Error ? err.message : String(err))) {
      return "absent";
    }
    throw err;
  }
  const failed = result?.failed ?? [];
  if (result?.purgeFailed || failed.length > 0) {
    const detail = [
      ...(result?.purgeFailed ? ["its sessions could not be purged"] : []),
      ...failed.map((f) => `${f.path}: ${f.reason}`),
    ].join("; ");
    throw new Error(
      `agent ${agentId} was removed from the roster but its clean-up did not finish (${detail}). Delete it again to retry — until that succeeds the id cannot be re-created.`,
    );
  }
  // The roster change reloads the gateway; don't hand control back mid-reload.
  await client.waitUntilReady();
  return "deleted";
}

/** True for `agent "<id>" not found`, what agent-scoped calls answer for an agent the gateway has not loaded. */
export function isAgentNotFoundError(err: unknown): boolean {
  return /agent "[^"]*" not found/i.test(
    err instanceof Error ? err.message : String(err),
  );
}

/**
 * Resolves once the running gateway can address `agentId`.
 *
 * `agents.create` returns as soon as the new agent is written to the config.
 * The running gateway only picks it up on the reload that write triggers, a
 * moment later, and `waitUntilReady()` does not cover that gap: the gateway is
 * ready throughout. Until the reload lands, every agent-scoped call
 * (`agents.files.set` first among them) fails with `agent "<id>" not found`.
 * Call this between creating an agent and using it.
 */
export async function waitForAgentLoaded(
  agentId: string,
  timeoutMs = 60_000,
  gatewayClient?: OpenClawClient,
): Promise<void> {
  const client = await clientFor(agentId, gatewayClient);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      // Any agent-scoped read does; a file the agent does not have yet still
      // answers without an error.
      await client.call("agents.files.get", { agentId, name: "AGENTS.md" });
      return;
    } catch (err) {
      if (!isAgentNotFoundError(err)) throw err;
      if (Date.now() >= deadline) {
        throw new Error(
          `the gateway did not load agent ${agentId} within ${Math.round(timeoutMs / 1000)}s of creating it`,
          { cause: err },
        );
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** True for the error `agents.create` returns while an earlier delete is unfinished. */
export function isDeletionPendingError(err: unknown): boolean {
  return /deletion cleanup is still pending/i.test(
    err instanceof Error ? err.message : String(err),
  );
}
