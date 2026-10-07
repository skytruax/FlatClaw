/**
 * Next.js server-boot hook. `register()` runs once when the server process
 * starts (Node runtime only). In the Kirk control container this is where the
 * portal applies DB migrations and seeds the bootstrap admin — replacing the
 * standalone `lib/db/migrate.ts` script, which doesn't survive into a
 * standalone image.
 *
 * Both steps are idempotent: drizzle skips already-applied migrations, and
 * seedAdminFromEnv no-ops once the admin exists. Guarded to the Node runtime
 * (better-sqlite3 is native and cannot load on the edge runtime).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const path = await import("node:path");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("./lib/db/client");

  // In the standalone image, migrations are copied to <cwd>/lib/db/migrations.
  // PORTAL_MIGRATIONS_DIR overrides for other layouts.
  const migrationsFolder =
    process.env.PORTAL_MIGRATIONS_DIR ??
    path.join(process.cwd(), "lib", "db", "migrations");

  migrate(db, { migrationsFolder });
  console.log(`[boot] migrations applied from ${migrationsFolder}`);

  // Per-user mode: the portal runs one gateway per user (lib/gateways/).
  // Bring up every provisioned gateway before anything talks to one. A
  // gateway that fails to start is reported; its user sees an error, the
  // rest of the portal works.
  const { gatewayMode } = await import("./lib/gateways/paths");
  console.log(`[boot] gateway mode: ${gatewayMode()}`);
  if (gatewayMode() === "per-user") {
    const { startAllGateways, unixIsolationEnabled } = await import("./lib/gateways/supervisor");
    console.log(`[boot] per-user gateways run ${unixIsolationEnabled() ? "under their own Unix accounts" : "as the portal's own user (no OS isolation: the portal is not root or FLATCLAW_GATEWAY_ISOLATION=none)"}`);
    const { started, failed } = await startAllGateways();
    console.log(`[boot] started ${started.length} per-user gateway(s)${failed.length ? `; ${failed.length} failed` : ""}`);
    for (const f of failed) console.error(`[boot] gateway for ${f.agentId} did not start: ${f.error}`);
  }

  const { seedAdminFromEnv, seedUsersFromEnv } = await import("./lib/auth/seed");
  await seedAdminFromEnv();
  // Team users + their agents (PORTAL_SEED_USERS). Idempotent; the gateway is
  // already up (start-control.sh starts it before the Portal), so agent
  // provisioning over loopback works.
  await seedUsersFromEnv();

  // Gateway-side invariants. Neither may take the portal down with it: with
  // the gateway unreachable the portal still has to boot (and says so).
  try {
    // Isolation settings + the built-in tool deny list. After an OpenClaw
    // upgrade this is what keeps new upstream defaults from applying. Covers
    // every gateway this portal runs.
    const { ensureTenantBaseline } = await import("./lib/openclaw/skills");
    if (await ensureTenantBaseline()) {
      console.log("[boot] wrote the FlatClaw tenant baseline into the gateway config");
    }
    // Tenants provisioned before MCP server names were capped at the gateway's
    // 30 characters: an over-long name is visible to every agent.
    await import("./lib/openclaw/services");
    const { repairLegacyServerNames } = await import("./lib/openclaw/managed-mcp");
    const repaired = await repairLegacyServerNames();
    if (repaired.length > 0) {
      console.log(`[boot] re-registered MCP servers for ${repaired.length} user(s) whose server names were too long`);
    }
  } catch (err) {
    console.error(
      "[boot] could not verify the gateway baseline / MCP server names — the gateway may be running with upstream defaults:",
      err,
    );
  }
}
