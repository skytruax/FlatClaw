// One-shot: recompute managed deny lists + strip the stale mcp__-prefixed
// patterns left over from before we corrected the tool-name format.
import { recomputeAgentToolPolicies } from "../lib/openclaw/cpanel-mcp";
import { agentEntries } from "../lib/openclaw/agent-roster";
import { readGatewayConfig, writeGatewayConfig } from "../lib/openclaw/gateway-config";

async function main() {
  const r = await recomputeAgentToolPolicies();
  console.log("recompute changed:", r.changedAgents.length, "agents");

  // Strip stale mcp__-prefixed deny patterns left over from a previous
  // (incorrect) version of the policy helper.
  const snapshot = await readGatewayConfig();
  let stripped = 0;
  for (const entry of Object.values(agentEntries(snapshot.blob))) {
    if (!Array.isArray(entry.tools?.deny)) continue;
    const filtered = entry.tools.deny.filter((p) => !p.startsWith("mcp__"));
    if (filtered.length === entry.tools.deny.length) continue;
    stripped++;
    if (filtered.length === 0) {
      const { deny: _d, ...rest } = entry.tools;
      void _d;
      if (Object.keys(rest).length) entry.tools = rest;
      else delete entry.tools;
    } else {
      entry.tools = { ...entry.tools, deny: filtered };
    }
  }
  console.log("stripped stale mcp__ from", stripped, "agents");
  console.log((await writeGatewayConfig(snapshot)) ? "config.set applied" : "no change");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("FATAL:", err);
    process.exit(1);
  },
);
