#!/usr/bin/env tsx
/**
 * One-shot: walk every registered managed service and bring every user to the
 * correct provisioning state (rewrites `mcp.servers.*` entries — command,
 * entry path, env — and recomputes deny lists). Run after moving MCP build
 * paths, changing a plugin's buildExtraEnv, or editing entry env vars.
 *
 *   npx tsx scripts/sync-managed-mcp.ts            # sync all services
 *   npx tsx scripts/sync-managed-mcp.ts jira       # sync one service
 */
import "../lib/openclaw/services";
import {
  listManagedMcpServices,
  syncManagedMcpForAllUsers,
  isServiceEnabled,
} from "../lib/openclaw/managed-mcp";

async function main() {
  const only = process.argv[2];
  for (const svc of listManagedMcpServices()) {
    if (only && svc.service !== only) continue;
    const enabled = await isServiceEnabled(svc.service);
    const r = await syncManagedMcpForAllUsers(svc.service);
    console.log(
      `${svc.service}: enabled=${enabled} provisioned=${r.provisioned.length} deprovisioned=${r.deprovisioned.length} skipped=${r.skipped.length}`,
    );
    for (const s of r.skipped) console.log(`  skipped ${s.userId}: ${s.reason}`);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
