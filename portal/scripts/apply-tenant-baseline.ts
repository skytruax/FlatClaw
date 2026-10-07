/**
 * Applies the FlatClaw tenant baseline to a gateway config FILE, with the
 * gateway stopped.
 *
 * The portal applies the same baseline over RPC when it boots
 * (`ensureTenantBaseline`, lib/openclaw/skills.ts). This offline form is for
 * the tenant container: infra/kirk/start-control.sh runs it between the state
 * migration and the gateway start, so that
 *
 *   - the gateway never serves a moment on OpenClaw's own defaults (cross-agent
 *     session access, the operator terminal, default-on plugins …), and
 *   - settings that restart a running gateway when they change
 *     (`memory.search`, for one) are already there when it starts.
 *
 * Both paths call the same `applyTenantBaseline`, so there is one definition
 * of the baseline: lib/openclaw/tenant-baseline.ts.
 *
 *   node apply-tenant-baseline.cjs <path to openclaw.json>
 *
 * Prints the keys it changed. Exits 1, leaving the file untouched, when the
 * config cannot be read as JSON. Never run it against the config of a running
 * gateway — use the portal, or `npm run test:gateway -- --apply-baseline`.
 */
import { chmodSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import type { ConfigBlob } from "../lib/openclaw/agent-roster";
import { applyTenantBaseline, tenantBaselineDrift } from "../lib/openclaw/tenant-baseline";

function main(): number {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: apply-tenant-baseline <path to openclaw.json>");
    return 2;
  }
  let cfg: ConfigBlob;
  try {
    cfg = JSON.parse(readFileSync(path, "utf8")) as ConfigBlob;
  } catch (err) {
    console.error(`[tenant-baseline] cannot read ${path} as JSON; nothing was changed:`, err instanceof Error ? err.message : err);
    return 1;
  }
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
    console.error(`[tenant-baseline] ${path} does not hold a config object; nothing was changed`);
    return 1;
  }
  const drift = tenantBaselineDrift(cfg);
  if (drift.length === 0) {
    console.log("[tenant-baseline] already in place");
    return 0;
  }
  applyTenantBaseline(cfg);
  // Same directory, then rename: the gateway must never find half a config.
  const mode = statSync(path).mode & 0o777;
  const tmp = `${path}.flatclaw-baseline.tmp`;
  writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, path);
  console.log(`[tenant-baseline] wrote ${drift.length} setting(s): ${drift.join(", ")}`);
  return 0;
}

process.exit(main());
