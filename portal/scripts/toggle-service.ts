#!/usr/bin/env tsx
/** Toggle a managed service's enabled/hidden state from the CLI (demo prep).
 *
 *   source .env.local && tsx scripts/toggle-service.ts <service> [enable|disable] [--hide|--show]
 *
 * `enable`/`disable` runs the full setServiceEnabled sync (provisions or
 * deprovisions the per-agent MCP servers for every user with credentials).
 * `--hide`/`--show` flips UI-only visibility (no provisioning change).
 * With no action args, prints the service's current state.
 */
import "../lib/openclaw/services"; // register managed-MCP plugins
import {
  setServiceEnabled,
  setServiceHidden,
  isServiceEnabled,
  isServiceHidden,
} from "../lib/openclaw/managed-mcp";

async function main() {
  const [service, ...rest] = process.argv.slice(2);
  if (!service) throw new Error("usage: toggle-service.ts <service> [enable|disable] [--hide|--show]");

  if (rest.includes("enable") || rest.includes("disable")) {
    const enable = rest.includes("enable");
    const sync = await setServiceEnabled(service, enable);
    console.log(`${service}: enabled=${enable}`);
    console.log(`  provisioned:   [${sync.provisioned.join(", ")}]`);
    console.log(`  deprovisioned: [${sync.deprovisioned.join(", ")}]`);
    if ((sync as { skipped?: unknown[] }).skipped?.length)
      console.log(`  skipped:`, JSON.stringify((sync as { skipped?: unknown[] }).skipped));
  }
  if (rest.includes("--hide")) { await setServiceHidden(service, true); console.log(`${service}: hidden=true`); }
  if (rest.includes("--show")) { await setServiceHidden(service, false); console.log(`${service}: hidden=false`); }

  console.log(`state: enabled=${await isServiceEnabled(service)} hidden=${await isServiceHidden(service)}`);
  process.exit(0);
}
main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
