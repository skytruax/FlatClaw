/**
 * Runs one OpenClaw gateway per portal user, as children of the portal.
 *
 * For an agent this creates, once: a state directory under gateways/, a Unix
 * account to run as (when the portal is root and isolation is not turned off),
 * the config from config-template.ts, the bundled plugins, and a row in
 * `agent_gateways` with a fresh token. Then it starts `openclaw gateway` with
 * OPENCLAW_STATE_DIR / OPENCLAW_CONFIG_PATH pointing at that directory,
 * waits for /startupz, and keeps the process up: an unexpected exit restarts
 * it with backoff. Before every start the config file gets the tenant
 * baseline and the current inference settings, the way start-control.sh does
 * for the shared gateway, and the state is migrated when the installed
 * OpenClaw version changed.
 *
 * Why a Unix account per gateway: it is what keeps one user's shell commands
 * out of another user's state. Two gateways under the same account would
 * share a filesystem and the gap would stay open.
 *
 * Secrets: a gateway's environment is the portal's minus the portal's own
 * secrets and minus anything that looks like a credential, because everything
 * in it is visible to the agent's shell. MCP servers get what they need from
 * their config entries (written by the portal), not from the environment.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync, chownSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import type { ConfigBlob } from "@/lib/openclaw/agent-roster";
import { applyTenantBaseline } from "@/lib/openclaw/tenant-baseline";
import { applyInferenceSettings, readInferenceSettings } from "@/lib/settings/inference";
import { buildUserGatewayConfig } from "./config-template";
import { gatewayChildEnv } from "./env";
export { PORTAL_ONLY_ENV, gatewayChildEnv } from "./env";
import { chownTree } from "./ownership";
import { allocateGatewayPort, assertAgentId, gatewayMode, gatewayStateDir, gatewayUnixUserName, gatewaysRoot } from "./paths";
import {
  clientForRecord, deleteGatewayRecord, forgetGatewayClient, gatewayRecord, listGatewayRecords, saveGatewayRecord,
  type GatewayRecord,
} from "./registry";

const log = (msg: string) => console.log(`[gateways] ${msg}`);

interface Running {
  child: ChildProcess;
  port: number;
  stoppedOnPurpose: boolean;
  /** SIGTERM already sent. A second SIGTERM makes OpenClaw exit at once, without releasing its state lease. */
  signalled: boolean;
  /** Settles when this start has reached /startupz (or failed); concurrent callers share it. */
  ready: Promise<void>;
  startedAt: number;
}
const PROCS_KEY = Symbol.for("flatclaw.gateway.processes");
type ProcSlot = { [PROCS_KEY]?: Map<string, Running> };
/** Consecutive failed or crashed starts per agent; drives the restart backoff, cleared by a start that succeeds. */
const failedStarts = new Map<string, number>();

function procs(): Map<string, Running> {
  const slot = globalThis as unknown as ProcSlot;
  if (!slot[PROCS_KEY]) {
    slot[PROCS_KEY] = new Map();
    // The portal going down takes its gateways with it. Each gateway releases
    // its state ownership lease while shutting down on SIGTERM, and in a
    // container the gateways die with PID 1, so the portal must not exit
    // until they have finished: otherwise every redeploy leaves leases behind
    // and the next pod's gateways fail to start for up to five minutes (seen
    // on the demo tenant, 2026-10-06). The signal handlers therefore wait
    // (bounded by FLATCLAW_GATEWAY_SHUTDOWN_GRACE_MS, default 25 s, inside a
    // typical 30 s termination grace period); the synchronous exit handler
    // is the fallback for a portal that exits on its own.
    const terminateChildren = () => {
      const children = [...slot[PROCS_KEY]!.values()].filter((r) => r.child.exitCode === null);
      for (const running of children) {
        running.stoppedOnPurpose = true;
        if (!running.signalled) {
          running.signalled = true;
          running.child.kill("SIGTERM");
        }
      }
      return children;
    };
    process.once("exit", terminateChildren);
    for (const [signal, code] of [["SIGTERM", 143], ["SIGINT", 130]] as const) {
      process.once(signal, () => {
        const children = terminateChildren();
        const grace = Number(process.env.FLATCLAW_GATEWAY_SHUTDOWN_GRACE_MS ?? 25_000) || 25_000;
        const deadline = Date.now() + grace;
        if (children.length) log(`${signal}: waiting up to ${grace / 1000}s for ${children.length} gateway(s) to shut down`);
        const finish = () => {
          for (const r of children) if (r.child.exitCode === null) r.child.kill("SIGKILL");
          if (process.listenerCount(signal) === 0) process.exit(code);
        };
        const poll = () => {
          if (children.every((r) => r.child.exitCode !== null)) {
            if (children.length) log(`${signal}: all gateways stopped`);
            finish();
          } else if (Date.now() >= deadline) {
            log(`${signal}: ${children.filter((r) => r.child.exitCode === null).length} gateway(s) still running after ${grace / 1000}s; killing`);
            finish();
          } else {
            setTimeout(poll, 100);
          }
        };
        poll();
      });
    }
  }
  return slot[PROCS_KEY]!;
}

export function openclawBin(): string {
  if (process.env.FLATCLAW_OPENCLAW_BIN) return process.env.FLATCLAW_OPENCLAW_BIN;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(dir, "openclaw");
    if (dir && existsSync(candidate)) return candidate;
  }
  throw new Error("openclaw is not on PATH; set FLATCLAW_OPENCLAW_BIN");
}

let installedVersionCache: string | null = null;
export function installedOpenclawVersion(): string {
  if (installedVersionCache) return installedVersionCache;
  // The control image records the version it installed; elsewhere ask the binary.
  const recorded = process.env.FLATCLAW_OPENCLAW_VERSION_FILE ?? "/opt/flatclaw/openclaw-version";
  if (existsSync(recorded)) {
    const v = readFileSync(recorded, "utf8").trim();
    if (/^\d{4}\.\d+\.\d+/.test(v)) { installedVersionCache = v; return v; }
  }
  const r = spawnSync(openclawBin(), ["--version"], { encoding: "utf8", env: gatewayChildEnv(process.env, null) });
  const match = /(\d{4}\.\d+\.\d+)/.exec(r.stdout ?? "");
  if (!match) throw new Error(`could not read the openclaw version: ${(r.stderr || r.stdout || "").slice(0, 200)}`);
  installedVersionCache = match[1];
  return match[1];
}

/** Whether gateways get their own Unix accounts: only as root, and unless switched off. */
export function unixIsolationEnabled(): boolean {
  if (process.env.FLATCLAW_GATEWAY_ISOLATION === "none") return false;
  return typeof process.getuid === "function" && process.getuid() === 0;
}

const asUser = (record: GatewayRecord) => (record.uid !== null && record.gid !== null ? { uid: record.uid, gid: record.gid } : {});

function run(record: GatewayRecord, args: string[], label: string, timeoutMs = 300_000): string {
  const r = spawnSync(openclawBin(), args, {
    encoding: "utf8", env: gatewayChildEnv(process.env, record), ...asUser(record), timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024,
  });
  if (r.error) throw new Error(`${label} failed to start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${label} exited ${r.status}: ${(r.stderr || r.stdout || "").slice(-600)}`);
  return r.stdout;
}

function ensureUnixUser(agentId: string): { uid: number; gid: number; unixUser: string } {
  const hash8 = createHash("sha256").update(agentId).digest("hex").slice(0, 8);
  const name = gatewayUnixUserName(agentId, hash8);
  const existing = spawnSync("id", ["-u", name], { encoding: "utf8" });
  if (existing.status !== 0) {
    const r = spawnSync("useradd", ["--system", "--no-create-home", "--shell", "/usr/sbin/nologin", name], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`useradd ${name} failed: ${(r.stderr || "").trim()}`);
    log(`created Unix account ${name} for ${agentId}`);
  }
  const uid = Number(spawnSync("id", ["-u", name], { encoding: "utf8" }).stdout.trim());
  const gid = Number(spawnSync("id", ["-g", name], { encoding: "utf8" }).stdout.trim());
  if (!Number.isInteger(uid) || !Number.isInteger(gid)) throw new Error(`could not resolve uid/gid for ${name}`);
  return { uid, gid, unixUser: name };
}

/**
 * Make sure the account a registered gateway runs as exists in this
 * container's /etc/passwd, with the uid and gid the registry recorded.
 * Accounts are created with useradd on the container's own filesystem, which
 * a new pod does not keep, while the gateway's files on the volume keep their
 * numeric owner. Without this a fresh pod runs the gateway as a nameless uid
 * (harmless by itself) and, worse, could hand that same uid to the next new
 * user. Called before any start and before any new account is created.
 */
function restoreUnixAccount(record: GatewayRecord): void {
  if (!unixIsolationEnabled() || record.uid === null || record.gid === null || !record.unixUser) return;
  const byName = spawnSync("id", ["-u", record.unixUser], { encoding: "utf8" });
  if (byName.status === 0) {
    const have = Number(byName.stdout.trim());
    if (have !== record.uid) log(`${record.agentId}: account ${record.unixUser} exists with uid ${have}, registry says ${record.uid}; leaving it`);
    return;
  }
  const group = spawnSync("getent", ["group", String(record.gid)], { encoding: "utf8" });
  if (group.status !== 0) {
    const g = spawnSync("groupadd", ["--system", "--gid", String(record.gid), record.unixUser], { encoding: "utf8" });
    if (g.status !== 0) throw new Error(`groupadd ${record.unixUser} (gid ${record.gid}) failed: ${(g.stderr || "").trim()}`);
  }
  const u = spawnSync("useradd", ["--system", "--no-create-home", "--shell", "/usr/sbin/nologin", "--uid", String(record.uid), "--gid", String(record.gid), record.unixUser], { encoding: "utf8" });
  if (u.status !== 0) throw new Error(`useradd ${record.unixUser} (uid ${record.uid}) failed: ${(u.stderr || "").trim()}`);
  log(`restored Unix account ${record.unixUser} (uid ${record.uid}) for ${record.agentId}`);
}

async function restoreAllUnixAccounts(): Promise<void> {
  if (!unixIsolationEnabled()) return;
  for (const record of await listGatewayRecords()) restoreUnixAccount(record);
}

const configPathOf = (record: GatewayRecord) => join(record.stateDir, "openclaw.json");
const versionMarker = (record: GatewayRecord) => join(record.stateDir, ".flatclaw-migrated-for");
const ownFile = (record: GatewayRecord, path: string) => {
  if (record.uid !== null && record.gid !== null) chownSync(path, record.uid, record.gid);
};

/** Read a gateway's config file. Throws when it is not JSON: writing anything back would wipe it. */
export function readGatewayConfigFile(record: GatewayRecord): ConfigBlob {
  const cfg = JSON.parse(readFileSync(configPathOf(record), "utf8")) as unknown;
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error(`${configPathOf(record)} does not hold a config object`);
  return cfg as ConfigBlob;
}

/** Same directory, then rename: the gateway must never find half a config. Owned by the gateway account. */
export function writeGatewayConfigFile(record: GatewayRecord, cfg: ConfigBlob): void {
  const path = configPathOf(record);
  const tmp = `${path}.flatclaw.tmp`;
  writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  ownFile(record, tmp);
  renameSync(tmp, path);
}

/**
 * With the gateway stopped: the tenant baseline, the inference settings, and
 * the port/token this record says. Returns what changed.
 */
export function reconcileGatewayConfigFile(record: GatewayRecord): string[] {
  const cfg = readGatewayConfigFile(record);
  const before = JSON.stringify(cfg);
  const changed: string[] = [];
  const gw = ((cfg as Record<string, unknown>).gateway ??= {}) as Record<string, unknown>;
  if (gw.port !== record.port) { gw.port = record.port; changed.push("gateway.port"); }
  const auth = (gw.auth ??= {}) as Record<string, unknown>;
  if (auth.mode !== "token" || auth.token !== record.token) { auth.mode = "token"; auth.token = record.token; changed.push("gateway.auth"); }
  if (gw.bind !== "loopback") { gw.bind = "loopback"; changed.push("gateway.bind"); }
  changed.push(...applyInferenceSettings(cfg, readInferenceSettings()));
  const baselineBefore = JSON.stringify(cfg);
  applyTenantBaseline(cfg);
  if (JSON.stringify(cfg) !== baselineBefore) changed.push("tenant baseline");
  if (JSON.stringify(cfg) !== before) writeGatewayConfigFile(record, cfg);
  return changed;
}

function bundledPluginsDir(): string | null {
  const dir = process.env.FLATCLAW_OPENCLAW_PLUGINS_DIR ?? "/opt/flatclaw/openclaw-plugins";
  return existsSync(dir) ? dir : null;
}

function installBundledPlugins(record: GatewayRecord): void {
  const dir = bundledPluginsDir();
  if (!dir) return;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".tgz")).sort()) {
    run(record, ["plugins", "install", join(dir, file), "--force", "--accept-capabilities"], `plugins install ${file}`);
  }
}

/** Bring the state on disk to the installed OpenClaw version (doctor, plugins), once per version. */
function migrateStateIfNeeded(record: GatewayRecord): void {
  const version = installedOpenclawVersion();
  const marker = versionMarker(record);
  const was = existsSync(marker) ? readFileSync(marker, "utf8").trim() : null;
  if (was === version) return;
  log(`${record.agentId}: migrating state for OpenClaw ${version} (was ${was ?? "none"})`);
  // Same order as start-control.sh: repair the config, then plugins, then
  // finish. The first pass may leave work parked; the config check decides.
  const first = spawnSync(openclawBin(), ["doctor", "--fix", "--non-interactive"], {
    encoding: "utf8", env: gatewayChildEnv(process.env, record), ...asUser(record), timeout: 900_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (first.status !== 0) log(`${record.agentId}: first doctor pass exited ${first.status}; checking the config before going on`);
  run(record, ["config", "validate"], "config validate", 120_000);
  installBundledPlugins(record);
  run(record, ["doctor", "--fix", "--non-interactive"], "doctor --fix", 900_000);
  writeFileSync(marker, `${version}\n`);
  ownFile(record, marker);
}

/**
 * Create the gateway for an agent if it does not exist yet: account, state
 * directory, config, plugins, registry row. Does not start it.
 */
export async function createGateway(agentId: string, userId: string): Promise<GatewayRecord> {
  assertAgentId(agentId);
  const existing = await gatewayRecord(agentId);
  if (existing) return existing;
  const all = await listGatewayRecords();
  const port = allocateGatewayPort(all.map((r) => r.port));
  const stateDir = gatewayStateDir(agentId);
  const token = randomBytes(32).toString("hex");
  // Existing gateways' accounts first, so useradd cannot reuse one of their uids.
  for (const record of all) restoreUnixAccount(record);
  const account = unixIsolationEnabled() ? ensureUnixUser(agentId) : { uid: null, gid: null, unixUser: null };
  const record: GatewayRecord = { agentId, userId, stateDir, port, ...account, token };

  mkdirSync(gatewaysRoot(), { recursive: true, mode: 0o711 });
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  mkdirSync(join(stateDir, "home"), { recursive: true, mode: 0o700 });
  mkdirSync(join(stateDir, `workspace-${agentId}`), { recursive: true, mode: 0o700 });
  if (!existsSync(configPathOf(record))) {
    const cfg = buildUserGatewayConfig({
      port, token, inference: readInferenceSettings(),
      // Outside the control image there is no plugin tarball to install; a
      // config that names a missing plugin would make the gateway complain.
      webSearch: bundledPluginsDir() !== null,
    });
    writeFileSync(configPathOf(record), `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  }
  writeFileSync(versionMarker(record), `${installedOpenclawVersion()}\n`);
  if (record.uid !== null && record.gid !== null) {
    chownTree(stateDir, record.uid, record.gid);
    chmodSync(stateDir, 0o700);
  }
  installBundledPlugins(record);
  await saveGatewayRecord(record);
  log(`created gateway for ${agentId}: port ${port}, state ${stateDir}${record.unixUser ? `, account ${record.unixUser}` : ""}`);
  return record;
}

async function waitForStartup(port: number, child: ChildProcess, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`gateway exited during startup (exit ${child.exitCode})`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/startupz`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`gateway on port ${port} did not finish starting within ${timeoutMs / 1000}s`);
}

/** Start an agent's gateway (no-op if running) and wait until it answers. */
export async function startGateway(agentId: string): Promise<GatewayRecord> {
  const record = await gatewayRecord(agentId);
  if (!record) throw new Error(`no gateway is provisioned for agent ${agentId}`);
  const running = procs().get(agentId);
  if (running && running.child.exitCode === null) {
    // Already running, or another caller's start is in flight: share its outcome.
    await running.ready;
    return record;
  }
  restoreUnixAccount(record);
  migrateStateIfNeeded(record);
  const changed = reconcileGatewayConfigFile(record);
  if (changed.length) log(`${agentId}: config reconciled before start (${changed.join(", ")})`);
  // The gateway writes its log straight to a file descriptor, not through a
  // pipe into this process: a pipe closes when the portal exits, and a
  // gateway still shutting down then dies on EPIPE before it has released
  // its state ownership lease (that is how a redeploy left leases behind).
  const logPath = join(record.stateDir, "gateway.log");
  const logFd = openSync(logPath, "a", 0o600);
  ownFile(record, logPath);
  let child: ChildProcess;
  try {
    child = spawn(openclawBin(), ["gateway", "--port", String(record.port)], {
      env: gatewayChildEnv(process.env, record), ...asUser(record), stdio: ["ignore", logFd, logFd], detached: false,
    });
  } finally {
    closeSync(logFd);
  }
  const ready = waitForStartup(record.port, child);
  // The promise is awaited below; this keeps a concurrent caller's rejection from being "unhandled".
  ready.catch(() => undefined);
  const entry: Running = { child, port: record.port, stoppedOnPurpose: false, signalled: false, ready, startedAt: Date.now() };
  procs().set(agentId, entry);
  child.on("exit", (code, signal) => {
    forgetGatewayClient(agentId);
    if (procs().get(agentId) === entry) procs().delete(agentId);
    if (entry.stoppedOnPurpose) { log(`${agentId}: gateway stopped`); return; }
    // Unexpected exit (a crash, or a start refused, e.g. while another
    // gateway's state lease is still active): try again, backing off from
    // 1 s to 60 s while it keeps failing.
    const failures = (failedStarts.get(agentId) ?? 0) + 1;
    failedStarts.set(agentId, failures);
    const delay = Math.min(60_000, 1_000 * 2 ** Math.min(failures - 1, 6));
    log(`${agentId}: gateway exited (code ${code}, signal ${signal}); restart ${failures} in ${delay / 1000}s`);
    setTimeout(() => {
      startGateway(agentId).catch((err) => log(`${agentId}: restart ${failures} failed: ${err instanceof Error ? err.message : err}`));
    }, delay).unref();
  });
  try {
    await ready;
  } catch (err) {
    // A child that exited is already being retried by the exit handler. One
    // that is still alive but never answered is stopped (once) and retried
    // by the same handler when it exits.
    if (child.exitCode === null && !entry.signalled) {
      entry.signalled = true;
      child.kill("SIGTERM");
    }
    throw err;
  }
  failedStarts.delete(agentId);
  log(`${agentId}: gateway up on port ${record.port} (pid ${child.pid})`);
  return record;
}

/** Create if needed, start, and return a connected client. */
export async function ensureGateway(agentId: string, userId: string) {
  if (gatewayMode() !== "per-user") throw new Error("ensureGateway is only for per-user mode");
  await createGateway(agentId, userId);
  const record = await startGateway(agentId);
  const client = clientForRecord(record);
  await client.waitUntilReady();
  return { record, client };
}

export async function stopGateway(agentId: string, graceMs = 15_000): Promise<void> {
  const running = procs().get(agentId);
  forgetGatewayClient(agentId);
  if (!running || running.child.exitCode !== null) { procs().delete(agentId); return; }
  running.stoppedOnPurpose = true;
  if (!running.signalled) {
    running.signalled = true;
    running.child.kill("SIGTERM");
  }
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => { running.child.kill("SIGKILL"); resolve(); }, graceMs);
    running.child.once("exit", () => { clearTimeout(t); resolve(); });
  });
  procs().delete(agentId);
}

export async function restartGateway(agentId: string): Promise<GatewayRecord> {
  await stopGateway(agentId);
  return startGateway(agentId);
}

export interface GatewayProcessStatus {
  state: "running" | "stopped";
  pid: number | null;
  /** Milliseconds since this start; null when stopped. */
  uptimeMs: number | null;
  restarts: number;
}

export function gatewayProcessStatus(agentId: string): GatewayProcessStatus {
  const running = procs().get(agentId);
  const restarts = failedStarts.get(agentId) ?? 0;
  if (!running || running.child.exitCode !== null) return { state: "stopped", pid: null, uptimeMs: null, restarts };
  return { state: "running", pid: running.child.pid ?? null, uptimeMs: Date.now() - running.startedAt, restarts };
}

/**
 * Remove a user's gateway: stop it, drop the registry row, move the state
 * directory to gateways/.trash/<agent>-<time> (owned by the portal, so the
 * account can no longer reach it), and delete the Unix account. The state is
 * kept on disk for an operator to inspect or delete.
 */
export async function destroyGateway(agentId: string): Promise<{ trashedTo: string | null }> {
  const record = await gatewayRecord(agentId);
  await stopGateway(agentId);
  if (!record) return { trashedTo: null };
  let trashedTo: string | null = null;
  if (existsSync(record.stateDir)) {
    const trash = join(gatewaysRoot(), ".trash");
    mkdirSync(trash, { recursive: true, mode: 0o700 });
    trashedTo = join(trash, `${agentId}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    renameSync(record.stateDir, trashedTo);
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      chownTree(trashedTo, 0, 0);
      chmodSync(trashedTo, 0o700);
    }
  }
  await deleteGatewayRecord(agentId);
  if (record.unixUser && unixIsolationEnabled()) {
    const r = spawnSync("userdel", [record.unixUser], { encoding: "utf8" });
    if (r.status !== 0) log(`${agentId}: userdel ${record.unixUser} exited ${r.status}: ${(r.stderr || "").trim()}`);
  }
  log(`removed gateway for ${agentId}${trashedTo ? ` (state kept at ${trashedTo})` : ""}`);
  return { trashedTo };
}

/**
 * At portal boot: start every provisioned gateway, a few at a time (a start
 * takes seconds; after an OpenClaw bump the state migration takes longer).
 * Failures are reported, not fatal.
 */
export async function startAllGateways(opts: { concurrency?: number } = {}): Promise<{ started: string[]; failed: Array<{ agentId: string; error: string }> }> {
  const started: string[] = [];
  const failed: Array<{ agentId: string; error: string }> = [];
  await restoreAllUnixAccounts();
  const queue = await listGatewayRecords();
  const configured = Number(process.env.FLATCLAW_GATEWAY_BOOT_CONCURRENCY ?? 4) || 4;
  const workers = Math.max(1, Math.min(opts.concurrency ?? configured, queue.length || 1));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (let record = queue.shift(); record; record = queue.shift()) {
        try {
          await startGateway(record.agentId);
          started.push(record.agentId);
        } catch (err) {
          failed.push({ agentId: record.agentId, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }),
  );
  // A start that was refused (for instance while a killed predecessor's
  // state lease is still active, up to five minutes on OpenClaw 2026.9) is
  // retried by the exit handler in startGateway with backoff. What that
  // cannot retry is a start that failed before any process existed (the
  // state migration, the config): those get the slower retry below. The
  // portal is up meanwhile.
  for (const f of failed) retryStartLater(f.agentId, 1);
  return { started, failed };
}

const BOOT_RETRY_EVERY_MS = 30_000;
const BOOT_RETRY_ATTEMPTS = 14;
function retryStartLater(agentId: string, attempt: number): void {
  if (attempt > BOOT_RETRY_ATTEMPTS) {
    log(`${agentId}: giving up on starting the gateway after ${BOOT_RETRY_ATTEMPTS} retries; use Start on the admin page`);
    return;
  }
  setTimeout(() => {
    // A process for this agent, or a pending restart of one, means the exit
    // handler has it; a running gateway means there is nothing left to do.
    if (procs().has(agentId) || failedStarts.has(agentId)) {
      if (gatewayProcessStatus(agentId).state !== "running" || failedStarts.has(agentId)) retryStartLater(agentId, attempt + 1);
      return;
    }
    startGateway(agentId)
      .then(() => log(`${agentId}: gateway started on boot retry ${attempt}`))
      .catch((err) => {
        log(`${agentId}: boot retry ${attempt} failed: ${err instanceof Error ? err.message : err}`);
        retryStartLater(agentId, attempt + 1);
      });
  }, BOOT_RETRY_EVERY_MS).unref();
}

export async function stopAllGateways(): Promise<void> {
  for (const agentId of [...procs().keys()]) await stopGateway(agentId);
}
