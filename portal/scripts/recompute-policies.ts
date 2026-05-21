// One-shot: recompute managed deny lists + strip the stale mcp__-prefixed
// patterns left over from before we corrected the tool-name format.
import { recomputeAgentToolPolicies } from "../lib/openclaw/cpanel-mcp";
import { getGatewayClient } from "../lib/openclaw/adapter";

interface ConfigGetResult {
  config: unknown;
  hash?: string;
  baseHash?: string;
  raw?: string;
}

interface AgentEntry {
  id?: string;
  tools?: { deny?: string[]; [k: string]: unknown };
  [k: string]: unknown;
}

async function main() {
  const r = await recomputeAgentToolPolicies();
  console.log("recompute changed:", r.changedAgents.length, "agents");

  // Strip stale mcp__-prefixed deny patterns left over from a previous
  // (incorrect) version of the policy helper.
  const client = getGatewayClient();
  const cur = (await client.call("config.get", {})) as ConfigGetResult;
  const blob =
    typeof cur.config === "string"
      ? (JSON.parse(cur.config) as { agents?: { list?: AgentEntry[] } })
      : (cur.config as { agents?: { list?: AgentEntry[] } });
  const before = JSON.stringify(blob);
  let stripped = 0;
  for (const a of blob.agents?.list ?? []) {
    if (Array.isArray(a.tools?.deny)) {
      const filtered = a.tools.deny.filter((p) => !p.startsWith("mcp__"));
      if (filtered.length !== a.tools.deny.length) {
        stripped++;
        if (filtered.length === 0) {
          const tools = a.tools as Record<string, unknown>;
          const { deny: _d, ...rest } = tools;
          void _d;
          if (Object.keys(rest).length) {
            a.tools = rest as AgentEntry["tools"];
          } else {
            delete a.tools;
          }
        } else {
          a.tools = { ...a.tools, deny: filtered };
        }
      }
    }
  }
  console.log("stripped stale mcp__ from", stripped, "agents");
  const after = JSON.stringify(blob);
  if (after !== before) {
    await client.call("config.set", { raw: after, baseHash: cur.hash ?? cur.baseHash });
    await client.waitUntilReady();
    console.log("config.set applied");
  } else {
    console.log("no change");
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("FATAL:", err);
    process.exit(1);
  },
);
