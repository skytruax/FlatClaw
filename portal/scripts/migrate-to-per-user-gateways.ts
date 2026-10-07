/**
 * Move a tenant from the one shared gateway to one gateway per user.
 *
 * Two phases, because the shared gateway has to be running for the first
 * and stopped for the second:
 *
 *   --export   Shared mode, shared gateway up. Reads, per portal user, the
 *              scheduled jobs (cron.list) and the size of the main
 *              transcript, into <portal data dir>/per-user-migration/export.json.
 *              Changes nothing.
 *
 *   --apply    FLATCLAW_GATEWAY_MODE=per-user, shared gateway stopped. For
 *              every portal user with an agent: creates their gateway
 *              (lib/gateways/supervisor.ts), copies the agent's state
 *              directory and workspace out of the shared state, carries the
 *              agent's config entry, the tenant defaults and the agent's own
 *              MCP server entries into the new config, starts the gateway,
 *              re-adds the exported scheduled jobs, and checks the
 *              transcript came along. The shared state is only read.
 *
 * Idempotent: a user who already has a gateway is skipped (--force redoes
 * them, replacing the copied state). --dry-run prints the plan. --only
 * a@b.com,c@d.com limits the run.
 *
 *   npx tsx scripts/migrate-to-per-user-gateways.ts --export --yes
 *   FLATCLAW_GATEWAY_MODE=per-user npx tsx scripts/migrate-to-per-user-gateways.ts --apply --yes
 *
 * In the control image: `cd /app/portal && node tools/migrate-to-per-user-gateways.cjs …`
 * (the operator runbook has the full procedure, including the volume backup
 * that comes first). Exit 0 = done, 1 = something failed, 2 = usage.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const option = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const EXPORT = argv.includes("--export");
const APPLY = argv.includes("--apply");
const DRY = argv.includes("--dry-run");
const FORCE = argv.includes("--force");
const NO_START = argv.includes("--no-start");
const ONLY = new Set((option("--only") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

if (EXPORT === APPLY) {
  console.error("usage: migrate-to-per-user-gateways (--export | --apply) --yes [--dry-run] [--force] [--only a@b,c@d] [--shared-state <dir>] [--no-start]");
  process.exit(2);
}
if (!argv.includes("--yes") && !DRY) {
  console.error(`This ${EXPORT ? "reads the shared gateway" : "creates per-user gateways from the shared state"}. Re-run with --yes (or --dry-run).`);
  process.exit(2);
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`FAIL  ${msg}`);
};
const ok = (msg: string) => console.log(`ok    ${msg}`);

interface ExportedUser {
  email: string;
  agentId: string;
  mainTranscriptMessages: number | null;
  cronJobs: Array<Record<string, unknown>>;
}
interface ExportFile {
  exportedAt: string;
  sharedGatewayVersion: string | null;
  users: ExportedUser[];
}

async function main(): Promise<number> {
  const { gatewayMode, portalDataDir, sharedStateDir } = await import("../lib/gateways/paths");
  const sharedState = option("--shared-state") ?? sharedStateDir();
  const exportDir = join(portalDataDir(), "per-user-migration");
  const exportPath = join(exportDir, "export.json");
  const { db, schema } = await import("../lib/db/client");
  const users = (await db.select().from(schema.users)).filter(
    (u) => u.agentId && (ONLY.size === 0 || ONLY.has(u.email.toLowerCase())),
  );
  console.log(`${EXPORT ? "export" : "apply"}: ${users.length} user(s) with an agent; shared state ${sharedState}; export file ${exportPath}${DRY ? "; DRY RUN" : ""}\n`);

  if (EXPORT) {
    if (gatewayMode() !== "shared") {
      console.error("--export runs in shared mode (FLATCLAW_GATEWAY_MODE unset), against the running shared gateway");
      return 2;
    }
    const { getGatewayClient } = await import("../lib/openclaw/adapter");
    const { isGatewayOwnedJob } = await import("../lib/scheduler/gateway-owned");
    const client = getGatewayClient();
    await client.connect();
    // The gateway caps `limit` at 200 (the same page the portal's scheduler reads).
    const jobsResult = (await client.call("cron.list", { includeDisabled: true, limit: 200 })) as { jobs?: Array<Record<string, unknown>> };
    const jobs = (jobsResult.jobs ?? []).filter((j) => !isGatewayOwnedJob(j as never));
    const out: ExportFile = { exportedAt: new Date().toISOString(), sharedGatewayVersion: client.getServerInfo()?.version ?? null, users: [] };
    for (const u of users) {
      const agentId = u.agentId!;
      let count: number | null = null;
      try {
        const h = (await client.call("chat.history", { sessionKey: `agent:${agentId}:main` })) as { messages?: unknown[] };
        count = h.messages?.length ?? 0;
      } catch (err) {
        fail(`${u.email}: chat.history: ${errText(err)}`);
      }
      const mine = jobs.filter((j) => j.agentId === agentId);
      out.users.push({ email: u.email, agentId, mainTranscriptMessages: count, cronJobs: mine });
      ok(`${u.email} (${agentId}): ${count ?? "?"} message(s) in the main transcript, ${mine.length} scheduled job(s)`);
    }
    if (!DRY) {
      mkdirSync(exportDir, { recursive: true, mode: 0o700 });
      writeFileSync(exportPath, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
      ok(`wrote ${exportPath}`);
    }
    client.close();
    return failures ? 1 : 0;
  }

  // ---- apply ---------------------------------------------------------------
  if (gatewayMode() !== "per-user") {
    console.error("--apply runs with FLATCLAW_GATEWAY_MODE=per-user");
    return 2;
  }
  const sharedConfigPath = join(sharedState, "openclaw.json");
  if (!existsSync(sharedConfigPath)) {
    console.error(`no shared config at ${sharedConfigPath}`);
    return 2;
  }
  const { normalizeAgentRoster } = await import("../lib/openclaw/agent-roster");
  const shared = JSON.parse(readFileSync(sharedConfigPath, "utf8")) as import("../lib/openclaw/agent-roster").ConfigBlob;
  normalizeAgentRoster(shared);
  const sharedPort = Number((shared.gateway as { port?: number } | undefined)?.port ?? 18789);
  try {
    const res = await fetch(`http://127.0.0.1:${sharedPort}/startupz`);
    console.error(`the shared gateway still answers on port ${sharedPort} (HTTP ${res.status}); stop it first so the copied state is consistent`);
    return 2;
  } catch {
    // not listening: good
  }
  const exported: ExportFile | null = existsSync(exportPath) ? (JSON.parse(readFileSync(exportPath, "utf8")) as ExportFile) : null;
  if (!exported) console.log("note: no export file; scheduled jobs will not be carried over and transcripts cannot be compared\n");

  await import("../lib/openclaw/services");
  const { managedServerPrefixes, managedServerName, legacyManagedServerName, isManagedDenyPattern } = await import("../lib/openclaw/agent-tool-policy");
  const supervisor = await import("../lib/gateways/supervisor");
  const registry = await import("../lib/gateways/registry");
  const { chownTree } = await import("../lib/gateways/ownership");
  const { workspacePathFor } = await import("../lib/gateways/paths");

  for (const u of users) {
    const agentId = u.agentId!;
    const label = `${u.email} (${agentId})`;
    const existing = await registry.gatewayRecord(agentId);
    if (existing && !FORCE) {
      ok(`${label}: already has a gateway on port ${existing.port}; skipped (--force to redo)`);
      continue;
    }
    const entry = shared.agents?.entries?.[agentId];
    if (!entry) {
      fail(`${label}: no agents.entries.${agentId} in the shared config`);
      continue;
    }
    const srcAgentDir = join(sharedState, "agents", agentId);
    const srcWorkspace = (entry.workspace as string | undefined) ?? join(sharedState, `workspace-${agentId}`);
    const prefixes = managedServerPrefixes();
    const mineNames = new Set(prefixes.flatMap((p) => [managedServerName(p, agentId), legacyManagedServerName(p, agentId)]));
    const mcpEntries = Object.entries(shared.mcp?.servers ?? {}).filter(([name]) => mineNames.has(name));
    const exportedUser = exported?.users.find((e) => e.agentId === agentId) ?? null;
    console.log(`\n${label}\n  agent dir   ${srcAgentDir}${existsSync(srcAgentDir) ? "" : "  (missing)"}\n  workspace   ${srcWorkspace}${existsSync(srcWorkspace) ? "" : "  (missing)"}\n  MCP servers ${mcpEntries.map(([n]) => n).join(", ") || "none"}\n  cron jobs   ${exportedUser?.cronJobs.length ?? "unknown"}`);
    if (DRY) continue;

    try {
      if (existing && FORCE) {
        await supervisor.destroyGateway(agentId);
      }
      const record = await supervisor.createGateway(agentId, u.id);
      const dstAgentDir = join(record.stateDir, "agents", agentId);
      const dstWorkspace = workspacePathFor(agentId);
      if (existsSync(srcAgentDir)) {
        rmSync(dstAgentDir, { recursive: true, force: true });
        cpSync(srcAgentDir, dstAgentDir, { recursive: true });
      }
      if (existsSync(srcWorkspace)) cpSync(srcWorkspace, dstWorkspace, { recursive: true });

      const cfg = supervisor.readGatewayConfigFile(record);
      cfg.agents = cfg.agents ?? {};
      if (shared.agents?.ownership) cfg.agents.ownership = shared.agents.ownership;
      cfg.agents.defaults = cfg.agents.defaults ?? {};
      for (const key of ["skills", "verboseDefault", "thinkingDefault"] as const) {
        if (shared.agents?.defaults?.[key] !== undefined) cfg.agents.defaults[key] = shared.agents.defaults[key];
      }
      const deny = Array.isArray(entry.tools?.deny) ? entry.tools.deny.filter((d) => !isManagedDenyPattern(d)) : [];
      const tools = { ...(entry.tools ?? {}) };
      if (deny.length) tools.deny = deny;
      else delete tools.deny;
      cfg.agents.entries = cfg.agents.entries ?? {};
      cfg.agents.entries[agentId] = {
        ...entry,
        workspace: dstWorkspace,
        agentDir: join(dstAgentDir, "agent"),
        ...(Object.keys(tools).length ? { tools } : {}),
      };
      if (!Object.keys(tools).length) delete (cfg.agents.entries[agentId] as Record<string, unknown>).tools;
      if (mcpEntries.length) {
        cfg.mcp = cfg.mcp ?? {};
        cfg.mcp.servers = cfg.mcp.servers ?? {};
        for (const [name, server] of mcpEntries) {
          const copy = { ...server, env: server.env ? { ...server.env } : undefined };
          if (copy.env?.OPENCLAW_WORKSPACE_PATH) copy.env.OPENCLAW_WORKSPACE_PATH = dstWorkspace;
          if (!copy.env) delete copy.env;
          cfg.mcp.servers[name] = copy;
        }
      }
      supervisor.writeGatewayConfigFile(record, cfg);
      if (record.uid !== null && record.gid !== null) chownTree(record.stateDir, record.uid, record.gid);
      ok(`${label}: state copied into ${record.stateDir}, config written (port ${record.port}${record.unixUser ? `, account ${record.unixUser}` : ""})`);

      if (NO_START) continue;
      await supervisor.startGateway(agentId);
      const client = await registry.gatewayClientFor(agentId);
      const roster = (await client.call("agents.list", {})) as { agents?: Array<{ id: string }> };
      if (!(roster.agents ?? []).some((a) => a.id === agentId)) {
        fail(`${label}: the new gateway does not list the agent (has ${(roster.agents ?? []).map((a) => a.id).join(",")})`);
        continue;
      }
      const history = (await client.call("chat.history", { sessionKey: `agent:${agentId}:main` })) as { messages?: unknown[] };
      const got = history.messages?.length ?? 0;
      if (exportedUser?.mainTranscriptMessages !== null && exportedUser?.mainTranscriptMessages !== undefined) {
        if (got === exportedUser.mainTranscriptMessages) ok(`${label}: main transcript carried over (${got} message(s))`);
        else fail(`${label}: main transcript has ${got} message(s), the shared gateway had ${exportedUser.mainTranscriptMessages}`);
      } else {
        ok(`${label}: main transcript has ${got} message(s) on the new gateway`);
      }
      let added = 0;
      for (const job of exportedUser?.cronJobs ?? []) {
        const { name, description, enabled, deleteAfterRun, schedule, payload, delivery } = job as Record<string, unknown>;
        try {
          await client.call("cron.add", {
            agentId, name, enabled, schedule, payload,
            ...(description ? { description } : {}),
            ...(deleteAfterRun !== undefined ? { deleteAfterRun } : {}),
            ...(delivery ? { delivery } : {}),
          });
          added++;
        } catch (err) {
          fail(`${label}: cron job ${JSON.stringify(name)} could not be re-added: ${errText(err)}`);
        }
      }
      if (exportedUser) ok(`${label}: ${added} of ${exportedUser.cronJobs.length} scheduled job(s) re-added`);
    } catch (err) {
      fail(`${label}: ${errText(err)}`);
    }
  }

  if (!DRY && !NO_START) {
    console.log("\nleaving the gateways running for the portal to adopt is not possible from a script: stopping them; the portal starts them at boot");
    await supervisor.stopAllGateways();
  }
  console.log(`\n${failures ? `${failures} FAILED` : "DONE"}`);
  return failures ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("migration aborted:", err);
    process.exit(1);
  });
