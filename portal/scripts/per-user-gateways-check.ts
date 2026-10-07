/**
 * Gateway-per-user check: does the portal's supervisor give each user a
 * gateway of their own, and do those gateways keep users apart?
 *
 * It runs the real supervisor (lib/gateways/) against a scratch portal
 * database and a scratch gateways directory, with a stand-in model in place
 * of Gemma, so it needs no GPU and touches no existing state:
 *
 *   gateways.created     two users → two gateways: own state dir, own port, own token
 *   gateways.baseline    each config file carries the tenant baseline and the inference settings
 *   gateways.up          each answers /startupz and models.list
 *   roster.isolated      each gateway lists only its own user's agent
 *   token.isolated       one user's token is refused by the other user's gateway
 *   turn.ok              a chat turn on each gateway reaches the stand-in and comes back
 *   exec.identity        `exec` runs as the gateway's own Unix account (root only)
 *   exec.isolated        `exec` on gateway A cannot read gateway B's config (root only)
 *   restart.history      stop + start a gateway: the transcript is still there
 *   inference.push       changing the endpoint in the portal reaches every gateway's config
 *   destroy              removing a user stops and unregisters their gateway, the other keeps running
 *
 * Without root there are no separate Unix accounts; the two exec checks are
 * then reported as skipped, not passed. Memory per gateway is printed for
 * capacity planning.
 *
 *   npx tsx scripts/per-user-gateways-check.ts --yes [--users 2] [--port-base 18900] [--keep]
 *
 * In the control image: `cd /app/portal && node tools/per-user-gateways-check.cjs --yes`
 * (as root, so the OS-level checks run). Exit 0 = all passed, 1 = a check
 * failed, 2 = usage.
 */
import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const option = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
if (!argv.includes("--yes")) {
  console.error("This starts OpenClaw gateways on this machine (scratch state, ports from --port-base). Re-run with --yes.");
  process.exit(2);
}
const USERS = Math.max(2, Number(option("--users") ?? 2) || 2);
const PORT_BASE = Number(option("--port-base") ?? 18900) || 18900;
const KEEP = argv.includes("--keep");

// Scratch environment: must be in place before any portal module loads (the
// DB client and the paths helpers read it at import).
const scratch = mkdtempSync(join(process.env.FLATCLAW_CHECK_TMP ?? tmpdir(), "flatclaw-per-user-"));
// mkdtemp makes it 0700. As root the gateways run as their own accounts and
// must be able to traverse down to their state directories (the real
// gateways root is created 0711 by the supervisor for the same reason).
chmodSync(scratch, 0o711);
process.env.FLATCLAW_GATEWAY_MODE = "per-user";
process.env.PORTAL_DB_PATH = join(scratch, "portal.db");
process.env.FLATCLAW_GATEWAYS_DIR = join(scratch, "gateways");
process.env.FLATCLAW_GATEWAY_PORT_BASE = String(PORT_BASE);
process.env.PORTAL_SECRETS_KEY = process.env.PORTAL_SECRETS_KEY ?? randomBytes(32).toString("hex");
delete process.env.PORTAL_SEED_USERS;
delete process.env.PROD_INFERENCE_URL;

let failed = 0;
let skipped = 0;
function check(id: string, ok: boolean | "skip", detail: string): void {
  if (ok === "skip") skipped++;
  else if (!ok) failed++;
  console.log(`${ok === "skip" ? "SKIP" : ok ? "PASS" : "FAIL"}  ${id.padEnd(20)} ${detail}`);
}
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- stand-in model -----------------------------------------------------------
// Answers PROBE_OK. A user message holding [[exec:<command>]] gets a tool call
// to `exec`; the follow-up request (which carries the tool result) gets the
// result echoed back as text, so the transcript shows what the shell saw.
interface OaiMessage { role: string; content?: unknown; tool_calls?: unknown[] }
let modelRequests = 0;
const standIn = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "stand-in", object: "model" }] }));
      return;
    }
    modelRequests++;
    const parsed = JSON.parse(body || "{}") as { messages?: OaiMessage[]; stream?: boolean };
    const messages = parsed.messages ?? [];
    if (process.env.FLATCLAW_CHECK_DUMP) {
      // Debugging aid: what the model request looked like, one line per message.
      const lines = messages.map((m, i) => `${i} ${m.role} ${JSON.stringify(m.content).slice(0, 160)}${m.tool_calls ? " +tool_calls" : ""}`);
      appendFileSync(join(scratch, "requests.log"), `--- request ${modelRequests}\n${lines.join("\n")}\n`);
    }
    const text = (m: OaiMessage | undefined): string => {
      if (!m) return "";
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) return m.content.map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : "")).join("");
      return "";
    };
    // The current turn starts at the last user message the person wrote.
    // The gateway appends its own user-role context message (marked
    // OPENCLAW_INTERNAL_CONTEXT) after the person's text and again after each
    // tool result, so "last user message" alone would not do. A tool result
    // after the person's message is this turn's result and gets echoed; an
    // [[exec:…]] marker in the person's message becomes a tool call; neither
    // means a plain turn.
    const isPerson = (m: OaiMessage) => m.role === "user" && !text(m).includes("OPENCLAW_INTERNAL_CONTEXT");
    let lastPersonIdx = -1;
    messages.forEach((m, i) => { if (isPerson(m)) lastPersonIdx = i; });
    const personText = lastPersonIdx >= 0 ? text(messages[lastPersonIdx]) : "";
    const found = [...personText.matchAll(/\[\[exec:([\s\S]+?)\]\]/g)];
    const command: string | null = found.length ? found[found.length - 1][1] : null;
    let reply: { content?: string; tool_calls?: unknown[] } = { content: "PROBE_OK" };
    if (command !== null) {
      const result = messages.slice(lastPersonIdx + 1).filter((m) => m.role === "tool").pop();
      if (result) {
        reply = { content: `TOOL_RESULT<<${text(result).slice(0, 2000)}>>` };
      } else {
        reply = { tool_calls: [{ id: `call_${randomUUID().slice(0, 8)}`, type: "function", function: { name: "exec", arguments: JSON.stringify({ command }) } }] };
      }
    }
    if (process.env.FLATCLAW_CHECK_DUMP) {
      appendFileSync(join(scratch, "requests.log"), `reply: lastPersonIdx=${lastPersonIdx} command=${JSON.stringify(command)} -> ${JSON.stringify(reply).slice(0, 160)}\n`);
    }
    const id = `chatcmpl-${randomUUID().slice(0, 8)}`;
    const created = Math.floor(Date.now() / 1000);
    const usage = { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 };
    const finish = reply.tool_calls ? "tool_calls" : "stop";
    if (!parsed.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id, object: "chat.completion", created, model: "stand-in", choices: [{ index: 0, message: { role: "assistant", content: reply.content ?? null, ...(reply.tool_calls ? { tool_calls: reply.tool_calls } : {}) }, finish_reason: finish }], usage }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const chunk = (delta: unknown, fin: string | null = null) =>
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: "stand-in", choices: [{ index: 0, delta, finish_reason: fin }] })}\n\n`);
    chunk({ role: "assistant", content: "" });
    if (reply.tool_calls) {
      const tc = reply.tool_calls[0] as { id: string; function: { name: string; arguments: string } };
      chunk({ tool_calls: [{ index: 0, id: tc.id, type: "function", function: { name: tc.function.name, arguments: "" } }] });
      chunk({ tool_calls: [{ index: 0, function: { arguments: tc.function.arguments } }] });
    } else {
      chunk({ content: reply.content });
    }
    chunk({}, finish);
    res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: "stand-in", choices: [], usage })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

function transcriptText(messages: Array<{ role?: string; content?: unknown }>): string {
  return messages
    .filter((m) => m.role === "assistant")
    .map((m) => (typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : "")).join("") : ""))
    .join("\n");
}

function rssMb(pid: number | null): string {
  if (pid === null) return "n/a";
  try {
    const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return m ? `${Math.round(Number(m[1]) / 1024)} MB` : "n/a";
  } catch {
    return "n/a";
  }
}

async function main(): Promise<number> {
  await new Promise<void>((resolve) => standIn.listen(0, "127.0.0.1", () => resolve()));
  const standInPort = (standIn.address() as { port: number }).port;
  const standInUrl = `http://127.0.0.1:${standInPort}/v1`;
  console.log(`scratch: ${scratch}\nstand-in model: ${standInUrl}\nports from: ${PORT_BASE}\n`);

  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db, schema } = await import("../lib/db/client");
  migrate(db, { migrationsFolder: join(process.cwd(), "lib", "db", "migrations") });
  const { saveInferenceSettings } = await import("../lib/settings/inference");
  const { pushInferenceSettings } = await import("../lib/settings/push-inference");
  saveInferenceSettings({ url: standInUrl, modelId: "stand-in", contextWindow: 32768 });
  const { provisionAgentForUser } = await import("../lib/openclaw/provision");
  const supervisor = await import("../lib/gateways/supervisor");
  const registry = await import("../lib/gateways/registry");
  const { OpenClawClient } = await import("../lib/openclaw/adapter");
  const { tenantBaselineDrift } = await import("../lib/openclaw/tenant-baseline");
  const bcrypt = (await import("bcryptjs")).default;

  const isolated = supervisor.unixIsolationEnabled();
  console.log(`OS isolation: ${isolated ? "on (running as root; one Unix account per gateway)" : "off (not root; gateways share this user)"}\n`);

  // --- users and their gateways -------------------------------------------
  const users: Array<{ id: string; email: string; agentId: string }> = [];
  const t0 = Date.now();
  for (let i = 0; i < USERS; i++) {
    const email = `check-${String.fromCharCode(97 + i)}@per-user.test`;
    const id = randomUUID();
    await db.insert(schema.users).values({ id, email, passwordHash: await bcrypt.hash("x", 4), role: "user", identityName: `Check ${i}` });
    const t = Date.now();
    const r = await provisionAgentForUser({ userId: id, email, identityName: `Check ${i}`, identityEmoji: null, modelRef: "openai/stand-in" });
    console.log(`      provisioned ${email} → ${r.agentId} in ${((Date.now() - t) / 1000).toFixed(1)}s`);
    users.push({ id, email, agentId: r.agentId });
  }
  console.log(`      ${USERS} users provisioned in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const records = await Promise.all(users.map((u) => registry.gatewayRecord(u.agentId)));
  const ports = new Set(records.map((r) => r?.port));
  const tokens = new Set(records.map((r) => r?.token));
  check(
    "gateways.created",
    records.every((r) => r && existsSync(r.stateDir)) && ports.size === USERS && tokens.size === USERS,
    `${records.filter(Boolean).length} records, ports ${[...ports].join(",")}, ${tokens.size} distinct tokens`,
  );

  let baselineOk = true;
  const baselineDetail: string[] = [];
  for (const r of records) {
    if (!r) continue;
    const cfg = JSON.parse(readFileSync(join(r.stateDir, "openclaw.json"), "utf8")) as Record<string, unknown>;
    const drift = tenantBaselineDrift(cfg);
    const provider = ((cfg.models as { providers?: Record<string, { baseUrl?: string }> })?.providers ?? {}).openai;
    const mode = statSync(r.stateDir).mode & 0o777;
    if (drift.length || provider?.baseUrl !== standInUrl || mode !== 0o700) baselineOk = false;
    baselineDetail.push(`${r.agentId}: drift=${drift.length} provider=${provider?.baseUrl === standInUrl ? "ok" : String(provider?.baseUrl)} mode=${mode.toString(8)}${r.unixUser ? ` account=${r.unixUser}` : ""}`);
  }
  check("gateways.baseline", baselineOk, baselineDetail.join("; "));

  let upOk = true;
  const upDetail: string[] = [];
  for (const r of records) {
    if (!r) continue;
    try {
      const res = await fetch(`http://127.0.0.1:${r.port}/startupz`);
      const client = await registry.gatewayClientFor(r.agentId);
      await client.call("models.list", {}, 10_000);
      const st = supervisor.gatewayProcessStatus(r.agentId);
      upDetail.push(`:${r.port} startupz=${res.status} pid=${st.pid} rss=${rssMb(st.pid)}`);
      if (!res.ok) upOk = false;
    } catch (err) {
      upOk = false;
      upDetail.push(`:${r.port} ${errText(err)}`);
    }
  }
  check("gateways.up", upOk, upDetail.join("; "));

  // --- isolation ------------------------------------------------------------
  let rosterOk = true;
  const rosterDetail: string[] = [];
  for (const u of users) {
    const client = await registry.gatewayClientFor(u.agentId);
    const r = (await client.call("agents.list", {})) as { agents?: Array<{ id: string }> };
    const ids = (r.agents ?? []).map((a) => a.id);
    const others = users.filter((o) => o !== u).map((o) => o.agentId);
    const leaks = ids.filter((id) => others.includes(id));
    if (!ids.includes(u.agentId) || leaks.length) rosterOk = false;
    rosterDetail.push(`${u.agentId}: [${ids.join(",")}]`);
  }
  check("roster.isolated", rosterOk, rosterDetail.join("; "));

  {
    const [a, b] = records as [NonNullable<(typeof records)[number]>, NonNullable<(typeof records)[number]>];
    const wrong = new OpenClawClient(`ws://127.0.0.1:${b.port}`, a.token);
    let refused = false;
    let detail = "";
    try {
      await wrong.connect(8000);
      await wrong.call("agents.list", {}, 5000);
      detail = "A's token was ACCEPTED by B's gateway";
    } catch (err) {
      refused = true;
      detail = `B's gateway refused A's token (${errText(err).slice(0, 80)})`;
    } finally {
      wrong.close();
    }
    check("token.isolated", refused, detail);
  }

  // --- turns ----------------------------------------------------------------
  async function turn(agentId: string, message: string, timeoutMs = 90_000): Promise<string> {
    const client = await registry.gatewayClientFor(agentId);
    const sessionKey = `agent:${agentId}:main`;
    const before = ((await client.call("chat.history", { sessionKey })) as { messages?: unknown[] }).messages?.length ?? 0;
    await client.call("chat.send", { sessionKey, message, idempotencyKey: randomUUID(), suppressCommandInterpretation: true });
    const deadline = Date.now() + timeoutMs;
    let last = "";
    while (Date.now() < deadline) {
      await sleep(700);
      const r = (await client.call("chat.history", { sessionKey })) as { messages?: Array<{ role?: string; content?: unknown }> };
      const msgs = r.messages ?? [];
      last = transcriptText(msgs.slice(before));
      if (/PROBE_OK|TOOL_RESULT<</.test(last)) return last;
    }
    throw new Error(`no final answer within ${timeoutMs / 1000}s (saw: ${last.slice(0, 120)})`);
  }

  let turnsOk = true;
  const turnDetail: string[] = [];
  for (const u of users) {
    try {
      const before = modelRequests;
      const text = await turn(u.agentId, "hello");
      turnDetail.push(`${u.agentId}: ${/PROBE_OK/.test(text) ? "PROBE_OK" : text.slice(0, 40)} (${modelRequests - before} model request(s))`);
      if (!/PROBE_OK/.test(text)) turnsOk = false;
    } catch (err) {
      turnsOk = false;
      turnDetail.push(`${u.agentId}: ${errText(err)}`);
    }
  }
  check("turn.ok", turnsOk, turnDetail.join("; "));

  const [ua, ub] = users;
  const [ra, rb] = records as [NonNullable<(typeof records)[number]>, NonNullable<(typeof records)[number]>];
  if (isolated) {
    try {
      const text = await turn(ua.agentId, `run this: [[exec:id -un; id -u]]`);
      const ok = text.includes(ra.unixUser ?? "\u0000") && !/\broot\b/.test(text);
      check("exec.identity", ok, `exec on A ran as: ${text.replace(/\s+/g, " ").slice(0, 100)}`);
    } catch (err) {
      check("exec.identity", false, errText(err));
    }
    try {
      const target = join(rb.stateDir, "openclaw.json");
      const text = await turn(ua.agentId, `run this: [[exec:cat ${target}]]`);
      const leaked = text.includes(rb.token);
      const denied = /denied|EACCES|cannot open|Permission/i.test(text);
      check("exec.isolated", denied && !leaked, leaked ? "A READ B's config including the token" : `A reading B's config: ${text.replace(/\s+/g, " ").slice(0, 110)}`);
    } catch (err) {
      check("exec.isolated", false, errText(err));
    }
  } else {
    check("exec.identity", "skip", "not root: gateways run as this user, no separate accounts to verify");
    check("exec.isolated", "skip", "not root: same account, same filesystem (run in the control container as root)");
  }

  // --- restart keeps history -----------------------------------------------
  try {
    const client = await registry.gatewayClientFor(ua.agentId);
    const sessionKey = `agent:${ua.agentId}:main`;
    const before = ((await client.call("chat.history", { sessionKey })) as { messages?: unknown[] }).messages?.length ?? 0;
    await supervisor.stopGateway(ua.agentId);
    const stopped = supervisor.gatewayProcessStatus(ua.agentId).state === "stopped";
    await supervisor.startGateway(ua.agentId);
    const after = ((await (await registry.gatewayClientFor(ua.agentId)).call("chat.history", { sessionKey })) as { messages?: unknown[] }).messages?.length ?? 0;
    check("restart.history", stopped && after === before && before > 0, `${before} message(s) before stop, ${after} after start`);
  } catch (err) {
    check("restart.history", false, errText(err));
  }

  // --- inference settings reach every gateway ------------------------------
  try {
    const altUrl = `http://127.0.0.1:${standInPort}/alt/v1`;
    saveInferenceSettings({ url: altUrl, modelId: "stand-in", contextWindow: 32768 });
    const pushed = await pushInferenceSettings();
    let all = true;
    for (const u of users) {
      const client = await registry.gatewayClientFor(u.agentId);
      const { readGatewayConfig } = await import("../lib/openclaw/gateway-config");
      const { blob } = await readGatewayConfig(client);
      const url = ((blob.models as { providers?: Record<string, { baseUrl?: string }> })?.providers ?? {}).openai?.baseUrl;
      if (url !== altUrl) all = false;
    }
    check("inference.push", all && pushed.failed.length === 0, `${pushed.updated.length} config(s) updated, ${pushed.failed.length} failed; files: ${records.map((r) => (JSON.parse(readFileSync(join(r!.stateDir, "openclaw.json"), "utf8")) as { models?: { providers?: Record<string, { baseUrl?: string }> } }).models?.providers?.openai?.baseUrl === altUrl ? "ok" : "stale").join(",")}`);
  } catch (err) {
    check("inference.push", false, errText(err));
  }

  // --- destroy one, the other lives ----------------------------------------
  try {
    const { trashedTo } = await supervisor.destroyGateway(ub.agentId);
    const gone = (await registry.gatewayRecord(ub.agentId)) === null && supervisor.gatewayProcessStatus(ub.agentId).state === "stopped" && !existsSync(rb.stateDir);
    let portFree = false;
    try {
      await fetch(`http://127.0.0.1:${rb.port}/startupz`);
    } catch {
      portFree = true;
    }
    const aAlive = !!(await (await registry.gatewayClientFor(ua.agentId)).call("models.list", {}, 10_000));
    check("destroy", gone && portFree && aAlive, `B unregistered=${gone} port ${rb.port} closed=${portFree} A still answers=${aAlive}${trashedTo ? ` state kept at ${trashedTo}` : ""}`);
  } catch (err) {
    check("destroy", false, errText(err));
  }

  {
    // Memory per gateway after a few minutes up, for capacity planning.
    const st = supervisor.gatewayProcessStatus(ua.agentId);
    console.log(`\nmemory: gateway A after ${Math.round((st.uptimeMs ?? 0) / 1000)}s up: RSS ${rssMb(st.pid)}`);
  }
  console.log(`model requests seen by the stand-in: ${modelRequests}`);
  await supervisor.stopAllGateways();
  standIn.close();
  if (!KEEP) rmSync(scratch, { recursive: true, force: true });
  else console.log(`kept ${scratch}`);
  console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} FAILED`}${skipped ? ` (${skipped} skipped)` : ""}`);
  return failed === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch(async (err) => {
    console.error("check aborted:", err);
    try {
      const supervisor = await import("../lib/gateways/supervisor");
      await supervisor.stopAllGateways();
    } catch (e) {
      console.error("could not stop gateways:", e);
    }
    process.exit(1);
  });
