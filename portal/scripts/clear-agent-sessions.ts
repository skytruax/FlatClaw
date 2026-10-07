#!/usr/bin/env tsx
/**
 * Delete every session of the given agents, through the gateway.
 *
 *   npx tsx scripts/clear-agent-sessions.ts <agentId> [<agentId> …]
 *
 * This is the "empty the Approvals queue" step of the demo reset scripts: the
 * queue is derived from session transcripts, so it empties when the sessions
 * go. Up to openclaw 2026.7 those scripts did it by moving the agent's
 * sessions/ directory aside while the gateway was stopped. Since 2026.8
 * sessions are rows in the agent's SQLite database, which only the gateway
 * may write — so this asks the gateway, and needs it running. Unlike the old
 * directory move, it is not reversible.
 *
 * The agent's `main` session cannot be deleted; it is reset instead (same
 * effect: an empty transcript).
 */
import { getGatewayClient } from "../lib/openclaw/adapter";

interface SessionRow {
  key?: string;
  sessionKey?: string;
}

async function clearAgent(agentId: string): Promise<{ deleted: number; reset: number }> {
  const client = getGatewayClient();
  const listed = (await client.call("sessions.list", { agentId, limit: 500 })) as {
    sessions?: SessionRow[];
  };
  let deleted = 0;
  let reset = 0;
  for (const row of listed.sessions ?? []) {
    const key = row.key ?? row.sessionKey;
    if (!key) continue;
    if (key === `agent:${agentId}:main`) {
      await client.call("sessions.reset", { key });
      reset++;
    } else {
      await client.call("sessions.delete", { key });
      deleted++;
    }
  }
  return { deleted, reset };
}

async function main() {
  const agentIds = process.argv.slice(2);
  if (agentIds.length === 0) {
    console.error("usage: tsx scripts/clear-agent-sessions.ts <agentId> [<agentId> …]");
    process.exit(2);
  }
  for (const agentId of agentIds) {
    const { deleted, reset } = await clearAgent(agentId);
    console.log(`  ${agentId}: ${deleted} session(s) deleted${reset ? ", main session reset" : ""}`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("FATAL:", err);
    process.exit(1);
  },
);
