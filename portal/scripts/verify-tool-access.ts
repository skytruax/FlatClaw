#!/usr/bin/env tsx
/** Show/set per-user tool access (built-in catalog + MCP inventory).
 *   tsx scripts/verify-tool-access.ts <agentId>            # show sections
 *   tsx scripts/verify-tool-access.ts <agentId> a__b,c     # set deny
 *   tsx scripts/verify-tool-access.ts <agentId> -          # clear deny */
import "../lib/openclaw/services";
import { readAgentToolAccess, setAgentToolDeny } from "../lib/openclaw/tool-access";

async function main() {
  const agentId = process.argv[2] ?? "skyler-flatclaw-org";
  const arg = process.argv[3];
  if (arg !== undefined) {
    const denied = arg === "-" ? [] : arg.split(",").map((s) => s.trim()).filter(Boolean);
    const { changed } = await setAgentToolDeny(agentId, denied);
    console.log(`set deny [${denied.join(", ")}] changed=${changed}`);
  }
  const a = await readAgentToolAccess(agentId);
  console.log(`agent=${a.agentId} exists=${a.exists} denied=${a.denied.length}`);
  for (const s of a.sections) console.log(`  [${s.source}] ${s.label}: ${s.tools.length} tools`);
  process.exit(0);
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
