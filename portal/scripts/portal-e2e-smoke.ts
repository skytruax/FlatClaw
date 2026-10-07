/**
 * Portal end-to-end smoke test: the HTTP layer a browser uses, against a
 * running portal and its gateway, with no GPU.
 *
 * scripts/gateway-contract-probe.ts checks the gateway through the adapter.
 * This one goes one layer up — it logs in like a user and drives the same
 * routes the chat page calls, so it also covers the adapter running inside
 * the Next.js server, the SSE relay, and transcript parsing:
 *
 *   login                 NextAuth credentials flow
 *   gateway-status        the portal reaches the gateway; version vs the pin
 *   stream + chat-send    a full turn: POST the message, watch the live events
 *   history               the transcript comes back as chat bubbles
 *   usage                 the context meter has a numerator and a denominator
 *   sessions              the session list includes the session just used
 *   compaction            "Tail-trim" works (the only compaction action left)
 *   scheduled-tasks       no gateway-owned monitor job shows up as a user task
 *
 * The turn runs on a throwaway agent (zz-smoke-agent) wired to a stand-in
 * model that answers PROBE_OK, both removed afterwards. Like the contract
 * probe it WRITES GATEWAY CONFIG — do not run it on a tenant with people in it.
 *
 * Run from portal/, with the portal up and its env loaded:
 *
 *   set -a; . .env.local; set +a
 *   npx tsx scripts/portal-e2e-smoke.ts --yes [--base http://127.0.0.1:3000]
 *
 * Needs PORTAL_ADMIN_EMAIL / PORTAL_ADMIN_PASSWORD. The chat routes act for a
 * portal user who has an agent; the admin acts "as" the first such user in
 * the portal DB (or --as-user <userId>), the way the admin chat page does —
 * but the turn itself runs on the throwaway agent's session, never theirs.
 * Exit code 0 = all passed, 1 = a check failed, 2 = usage.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { getGatewayClient } from "../lib/openclaw/adapter";
import { deleteGatewayAgent } from "../lib/openclaw/agent-lifecycle";
import { findAgentEntry, type ConfigBlob } from "../lib/openclaw/agent-roster";
import { readGatewayConfig, writeGatewayConfig } from "../lib/openclaw/gateway-config";
import { isGatewayOwnedJob } from "../lib/scheduler/gateway-owned";
import { db, schema } from "../lib/db/client";

const argv = process.argv.slice(2);
const option = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const BASE = (option("--base") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const MOCK_PORT = Number(option("--mock-port") ?? 18998);
const AGENT = "zz-smoke-agent";
const PROVIDER = "flatclaw-smoke";
const MODEL_REF = `${PROVIDER}/stand-in`;
const SESSION_KEY = `agent:${AGENT}:main`;

let failed = 0;
function check(id: string, ok: boolean, detail: string): boolean {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${id.padEnd(22)} ${detail}`);
  return ok;
}
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- a browser's cookie jar, minimal ---------------------------------------
const cookies = new Map<string, string>();
function absorb(res: Response): void {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
}
const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: "manual",
    headers: { ...(init.headers as Record<string, string> | undefined), cookie: cookieHeader() },
  });
  absorb(res);
  return res;
}
async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await api(path, init);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
}
const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// --- stand-in model: always answers PROBE_OK --------------------------------
let modelRequests = 0;
const standIn = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "stand-in", object: "model" }] }));
      return;
    }
    modelRequests++;
    const stream = body.includes('"stream":true');
    const id = `chatcmpl-smoke-${randomUUID().slice(0, 8)}`;
    const created = Math.floor(Date.now() / 1000);
    const usage = { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 };
    if (!stream) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id, object: "chat.completion", created, model: "stand-in", choices: [{ index: 0, message: { role: "assistant", content: "PROBE_OK" }, finish_reason: "stop" }], usage }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const chunk = (delta: unknown, finish: string | null = null) =>
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: "stand-in", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    chunk({ role: "assistant", content: "" });
    chunk({ content: "PROBE_OK" });
    chunk({}, "stop");
    res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: "stand-in", choices: [], usage })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

// --- the portal's SSE relay --------------------------------------------------
interface StreamEvent { event: string; data: Record<string, unknown> }
async function openEventStream(agentId: string, onEvent: (e: StreamEvent) => void): Promise<() => void> {
  const abort = new AbortController();
  const res = await fetch(`${BASE}/api/runtime/stream?agent=${encodeURIComponent(agentId)}`, {
    headers: { cookie: cookieHeader(), accept: "text/event-stream" },
    signal: abort.signal,
  });
  if (!res.ok || !res.body) throw new Error(`event stream: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const event = frame.match(/^event: (.*)$/m)?.[1];
          const data = frame.match(/^data: (.*)$/m)?.[1];
          if (event && data) onEvent({ event, data: JSON.parse(data) as Record<string, unknown> });
        }
      }
    } catch (err) {
      if (!abort.signal.aborted) console.error("[smoke] event stream ended:", errText(err));
    }
  })();
  return () => abort.abort();
}

async function setUpGateway(original: { raw: string }): Promise<void> {
  const client = getGatewayClient();
  original.raw = (await readGatewayConfig()).before;
  await deleteGatewayAgent(AGENT); // clears a leftover from an interrupted run
  await client.call("agents.create", { name: AGENT, workspace: `${homedir()}/.openclaw/workspace-${AGENT}` }, 60_000);
  await client.waitUntilReady();
  const snapshot = await readGatewayConfig();
  const blob = snapshot.blob as ConfigBlob & { models?: { providers?: Record<string, unknown> } };
  blob.models = blob.models ?? {};
  blob.models.providers = blob.models.providers ?? {};
  blob.models.providers[PROVIDER] = {
    baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, apiKey: "no-auth-needed", api: "openai-completions", timeoutSeconds: 120,
    models: [{ id: "stand-in", name: "Smoke test stand-in", api: "openai-completions", contextWindow: 262144, maxTokens: 1024, reasoning: false, input: ["text"], compat: { supportsTools: true } }],
  };
  const policy = (blob.agents?.defaults as { modelPolicy?: { allow?: string[] } } | undefined)?.modelPolicy;
  if (Array.isArray(policy?.allow) && !policy.allow.includes(MODEL_REF)) policy.allow.push(MODEL_REF);
  const entry = findAgentEntry(blob, AGENT);
  if (!entry) throw new Error(`${AGENT} is missing from the roster right after agents.create`);
  entry.model = MODEL_REF;
  await writeGatewayConfig(snapshot);
  for (let i = 0; i < 30; i++) {
    const listed = (await client.call("models.list", {})) as { models?: Array<{ provider?: string; id?: string }> };
    if ((listed.models ?? []).some((m) => `${m.provider}/${m.id}` === MODEL_REF)) return;
    await sleep(1_000);
  }
  throw new Error(`the gateway never listed ${MODEL_REF}`);
}

async function tearDownGateway(original: { raw: string }): Promise<void> {
  await deleteGatewayAgent(AGENT);
  if (!original.raw) return;
  const current = await readGatewayConfig();
  await writeGatewayConfig({ blob: JSON.parse(original.raw) as ConfigBlob, hash: current.hash, before: current.before });
}

async function main(): Promise<number> {
  if (!argv.includes("--yes")) {
    console.error("This smoke test writes gateway config (the gateway reloads and aborts runs in flight).\nRe-run with --yes on a portal nobody is using.  See the header of this file.");
    return 2;
  }
  const email = process.env.PORTAL_ADMIN_EMAIL;
  const password = process.env.PORTAL_ADMIN_PASSWORD;
  if (!email || !password) {
    console.error("PORTAL_ADMIN_EMAIL / PORTAL_ADMIN_PASSWORD are not set — load portal/.env.local first.");
    return 2;
  }

  // --- login ---------------------------------------------------------------
  const csrf = await json<{ csrfToken?: string }>("/api/auth/csrf");
  const login = await api("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrf.body.csrfToken ?? "", email, password, callbackUrl: `${BASE}/` }),
  });
  const me = await json<{ user?: { id?: string; role?: string } }>("/api/auth/session");
  if (!check("login", me.body.user?.role === "admin", `signed in as an admin (callback HTTP ${login.status})`)) return 1;

  // A provisioned user for the admin to act as (see the header).
  const asUser =
    option("--as-user") ??
    (await db.select().from(schema.users)).find((u) => !!u.agentId)?.id;
  if (!asUser) {
    console.error("No portal user has an agent yet — provision one, or pass --as-user <userId>.");
    return 2;
  }

  await new Promise<void>((resolve, reject) => standIn.once("error", reject).listen(MOCK_PORT, "127.0.0.1", resolve));
  const original = { raw: "" };
  let closeStream: (() => void) | null = null;
  try {
    const status = await json<{ ok?: boolean; openclaw?: { gateway?: string; verified?: string; status?: string }; error?: string }>("/api/portal/gateway-status");
    check("gateway-status", status.body.ok === true && status.body.openclaw?.status === "match",
      status.body.ok ? `gateway reachable; openclaw ${status.body.openclaw?.gateway} vs pin ${status.body.openclaw?.verified} (${status.body.openclaw?.status})` : `not ok: ${status.body.error}`);

    await setUpGateway(original);

    // --- a full turn through the routes the chat page uses -------------------
    const events: StreamEvent[] = [];
    closeStream = await openEventStream(AGENT, (e) => events.push(e));
    for (let i = 0; i < 50 && !events.some((e) => e.event === "ready"); i++) await sleep(100);
    check("stream.ready", events.some((e) => e.event === "ready"), "SSE relay connected and announced the agent");

    const idempotencyKey = randomUUID();
    const sent = await json<{ ok?: boolean; error?: string; result?: { runId?: string } }>(
      "/api/runtime/chat-send", post({ targetUserId: asUser, sessionKey: SESSION_KEY, message: "Smoke test. Reply PROBE_OK.", idempotencyKey }));
    check("chat-send", sent.status === 200 && sent.body.ok === true, sent.body.ok ? `accepted, runId ${sent.body.result?.runId === idempotencyKey ? "= idempotencyKey" : sent.body.result?.runId}` : `HTTP ${sent.status}: ${sent.body.error}`);

    const isFinal = (e: StreamEvent) => e.event === "chat" && e.data.sessionKey === SESSION_KEY && ["final", "error", "aborted"].includes(String(e.data.state));
    for (let i = 0; i < 1200 && !events.some(isFinal); i++) await sleep(100);
    const final = events.find(isFinal);
    const finalText = ((final?.data.message as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content ?? [])
      .filter((b) => b.type === "text").map((b) => b.text).join("");
    const names = [...new Set(events.filter((e) => e.data.sessionKey === SESSION_KEY).map((e) => e.event))];
    check("stream.turn", final?.data.state === "final" && finalText.includes("PROBE_OK"),
      final ? `live events [${names.join(", ")}] ended in ${final.data.state} with text ${JSON.stringify(finalText.slice(0, 40))}` : `no final chat event within 120s (events seen: ${names.join(", ") || "none"})`);
    check("model.reached", modelRequests > 0, `${modelRequests} request(s) reached the stand-in model`);

    const key = encodeURIComponent(SESSION_KEY);
    const history = await json<{ bubbles?: Array<{ role?: string; text?: string }>; messageCount?: number; error?: string }>(`/api/portal/sessions/${key}/history`);
    const bubbles = history.body.bubbles ?? [];
    check("history", bubbles.some((b) => b.role === "user") && bubbles.some((b) => b.role === "assistant" && (b.text ?? "").includes("PROBE_OK")),
      history.status === 200 ? `${history.body.messageCount} transcript message(s) → ${bubbles.length} bubble(s): ${bubbles.map((b) => b.role).join(", ")}` : `HTTP ${history.status}: ${history.body.error}`);

    const usage = await json<{ contextTokens?: number | null; estimatedPromptTokens?: number | null; totalTokens?: number | null }>(`/api/portal/sessions/${key}/usage`);
    check("usage", usage.status === 200 && typeof usage.body.contextTokens === "number" && (usage.body.estimatedPromptTokens ?? usage.body.totalTokens ?? 0) > 0,
      `context meter: ${usage.body.totalTokens ?? usage.body.estimatedPromptTokens} / ${usage.body.contextTokens} tokens`);

    const sessions = await json<{ sessions?: Array<{ sessionKey?: string; isMain?: boolean }>; error?: string }>(`/api/portal/sessions?agent=${AGENT}`);
    check("sessions", (sessions.body.sessions ?? []).some((s) => s.sessionKey === SESSION_KEY),
      sessions.status === 200 ? `session list returns ${(sessions.body.sessions ?? []).length} session(s) including the one just used` : `HTTP ${sessions.status}: ${sessions.body.error}`);

    const compact = await json<{ ok?: boolean; error?: string }>(`/api/portal/sessions/${key}/compaction`, post({ action: "compact", maxLines: 200 }));
    check("compaction", compact.status === 200 && compact.body.ok === true, compact.body.ok ? "tail-trim accepted" : `HTTP ${compact.status}: ${compact.body.error}`);
    const retired = await json<{ error?: string }>(`/api/portal/sessions/${key}/compaction`, post({ action: "restore", checkpointId: "x" }));
    check("compaction.retired", retired.status === 400, `checkpoint restore is refused by the portal itself (HTTP ${retired.status})`);

    const tasks = await json<{ agentId?: string; tasks?: Array<{ name?: string }>; error?: string }>(`/api/portal/scheduled-tasks?targetUserId=${encodeURIComponent(asUser)}`);
    const all = (await getGatewayClient().call("cron.list", { includeDisabled: true, limit: 200 })) as { jobs?: Array<{ agentId?: string; name?: string; declarationKey?: string }> };
    const hidden = (all.jobs ?? []).filter((j) => j.agentId === tasks.body.agentId && isGatewayOwnedJob(j));
    const leaked = (tasks.body.tasks ?? []).filter((t) => hidden.some((h) => h.name === t.name));
    check("scheduled-tasks", tasks.status === 200 && leaked.length === 0,
      tasks.status === 200 ? `${(tasks.body.tasks ?? []).length} user task(s) listed for ${tasks.body.agentId}; ${hidden.length} gateway-owned job(s) on that agent stay hidden` : `HTTP ${tasks.status}: ${tasks.body.error}`);
  } catch (err) {
    check("smoke.error", false, err instanceof Error ? err.stack ?? err.message : String(err));
  } finally {
    closeStream?.();
    try {
      await tearDownGateway(original);
      console.log("      clean-up               throwaway agent and stand-in provider removed");
    } catch (err) {
      check("clean-up", false, errText(err));
    }
    standIn.close();
    getGatewayClient().close();
  }
  console.log(`\n${failed === 0 ? "all checks passed" : `${failed} check(s) failed`}`);
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("FATAL:", err);
    process.exit(1);
  },
);
