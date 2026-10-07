/**
 * Live contract probe: FlatClaw ↔ the OpenClaw gateway it is pinned to.
 *
 * FlatClaw's isolation is not enforced by FlatClaw code. It is enforced by the
 * gateway, from config the portal writes (per-agent `tools.deny` globs over
 * `<server>__<tool>` names). The unit tests only prove we *compute* the right
 * config; whether the gateway still *honours* it is a property of the
 * installed OpenClaw. This script checks that property against a running
 * gateway, through the portal's real adapter, with no GPU:
 *
 *   connect     the adapter's handshake is accepted with every scope
 *   surface     every RPC method / event the portal uses still exists
 *   baseline    the tenant baseline (lib/openclaw/tenant-baseline.ts) is applied
 *   isolation   a stand-in model records the tool list each agent is actually
 *               offered: the owner sees its own MCP server, another agent sees
 *               none of it (including a server with a long name), and the
 *               built-in roster is the expected one, and every tool in the
 *               gateway's catalog is decided in tenant-baseline.ts; the
 *               session tools cannot read, write, spawn or list across agents
 *   approvals   an MCP approval envelope survives into the transcript verbatim
 *   sessions    the portal's session / chat / usage calls and their shapes
 *   provision   agents.create → workspace files → scheduled task → agents.delete
 *
 * It creates two throwaway agents (zz-probe-*), a temporary model provider and
 * two temporary MCP servers, and removes all of them afterwards, restoring the
 * config document it found.
 *
 * It WRITES GATEWAY CONFIG, and every config write reloads the gateway, which
 * aborts runs in flight. Do not run it against a tenant with people in it.
 *
 * Run from portal/ on the gateway's host, on every OpenClaw pin bump:
 *
 *   npm run test:gateway          (= npx tsx scripts/gateway-contract-probe.ts --yes)
 *
 * Inside the control container (no tsx there; the image carries a bundle):
 *
 *   cd /app/portal && node tools/gateway-contract-probe.cjs --yes
 *
 * Options:
 *   --yes               required; acknowledges the gateway reloads
 *   --apply-baseline    write the tenant baseline first if it is missing
 *   --agents a,b        also check these existing agents' offered tools
 *   --out report.json   write the full report
 *   --mock-port 18999   port for the stand-in model (must be reachable from
 *                       the gateway as 127.0.0.1)
 *   --fixture <path>    the stub MCP server (default: found next to this
 *                       script — scripts/fixtures/ in the repo, tools/ in the
 *                       control image, where this runs as a bundled .cjs)
 *
 * Exit code 0 = every check passed, 1 = a contract check failed, 2 = usage.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { getGatewayClient } from "../lib/openclaw/adapter";
import { waitForAgentLoaded } from "../lib/openclaw/agent-lifecycle";
import { TOOL_SEARCH_DIRECT_TOOLS, toolSearchEnabled, unwrapToolCall, unwrapToolResult } from "../lib/openclaw/tool-call-wrapper";
import { RELAYED_GATEWAY_EVENTS, eventSessionKey } from "../lib/openclaw/stream-events";
import { agentEntries, findAgentEntry, type ConfigBlob } from "../lib/openclaw/agent-roster";
import {
  applyManagedToolPolicies,
  denyPatternForServer,
  managedServerName,
  registerManagedPrefix,
} from "../lib/openclaw/agent-tool-policy";
import { readGatewayConfig, writeGatewayConfig } from "../lib/openclaw/gateway-config";
import { isGatewayOwnedJob } from "../lib/scheduler/gateway-owned";
import { ensureTenantBaseline } from "../lib/openclaw/skills";
import {
  DENIED_BUILTIN_TOOLS,
  EXPECTED_BUILTIN_TOOLS,
  OPTIONAL_BUILTIN_TOOLS,
  builtinToolDecision,
  tenantBaselineDrift,
} from "../lib/openclaw/tenant-baseline";
import { OPENCLAW_VERIFIED_VERSION } from "../lib/openclaw/version-pin";

// ---------------------------------------------------------------------------
// What the portal uses. Keep in step with the call sites under app/ and lib/.
// ---------------------------------------------------------------------------
const PORTAL_METHODS = [
  "sessions.subscribe", "models.list",
  "agents.list", "agents.create", "agents.delete", "agents.files.set", "agents.files.get",
  "config.get", "config.set",
  "tools.catalog", "skills.status",
  "sessions.list", "sessions.create", "sessions.patch", "sessions.delete",
  "sessions.usage", "sessions.describe", "sessions.compact",
  "chat.history", "chat.send", "chat.abort",
  "cron.list", "cron.add", "cron.update", "cron.remove", "cron.run", "cron.runs", "cron.status",
];
/** Callable but historically absent from the advertised list. */
const UNADVERTISED_OK = new Set(["sessions.usage"]);
const PORTAL_EVENTS = ["connect.challenge", "chat", "agent", "session.tool", "session.message", "sessions.changed"];
const REQUIRED_SCOPES = ["operator.admin", "operator.read", "operator.write", "operator.approvals", "operator.pairing"];
/** Workspace files the portal writes through agents.files.set. */
const PORTAL_WORKSPACE_FILES = ["SOUL.md", "AGENTS.md", "IDENTITY.md", "USER.md", "BOOTSTRAP.md", "MEMORY.md"];

/** The Tool Search controls as the catalog names them; decided by tool-call-wrapper.ts, not the baseline. */
const TOOL_SEARCH_CONTROL_IDS = new Set(["tool_search", "tool_describe", "tool_call"]);
const OWNER = "zz-probe-owner";
const OTHER = "zz-probe-other";
/** A third "user" who never exists as an agent — only as the owner of a long-named server. */
const LONG_OWNER = "zz-probe-long-agent-identifier-abcdef";
const PROBE_PREFIX = "zzprobe-";
const PROVIDER = "flatclaw-probe";
const MODEL_REF = `${PROVIDER}/stand-in`;
const GATEWAY_SERVER_NAME_MAX = 30; // openclaw: TOOL_NAME_MAX_PREFIX in agent-bundle-mcp-names.ts

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const option = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const MOCK_PORT = Number(option("--mock-port") ?? 18999);
const OUT = option("--out");
const EXTRA_AGENTS = (option("--agents") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// Check bookkeeping
// ---------------------------------------------------------------------------
type Status = "pass" | "fail" | "warn" | "info";
interface Check { id: string; status: Status; detail: string }
const checks: Check[] = [];
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), pin: OPENCLAW_VERIFIED_VERSION };
const MARK: Record<Status, string> = { pass: "PASS", fail: "FAIL", warn: "WARN", info: "INFO" };
function record(id: string, status: Status, detail: string): void {
  checks.push({ id, status, detail });
  console.log(`${MARK[status]}  ${id.padEnd(34)} ${detail}`);
}
function expect(id: string, ok: boolean, detail: string, failDetail?: string): boolean {
  record(id, ok ? "pass" : "fail", ok ? detail : failDetail ?? detail);
  return ok;
}
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const keysOf = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v as object).sort() : [];

// ---------------------------------------------------------------------------
// Gateway access — everything goes through the portal's adapter.
// ---------------------------------------------------------------------------
const client = getGatewayClient();
// Everything the gateway broadcasts to this connection during the run, by event name.
const broadcasts = new Map<string, { withKey: number; withoutKey: number; keys: string[]; reasons: string[] }>();
client.on((event, payload) => {
  const entry = broadcasts.get(event) ?? { withKey: 0, withoutKey: 0, keys: [], reasons: [] };
  if (eventSessionKey(payload) !== null) entry.withKey++;
  else {
    entry.withoutKey++;
    if (payload && typeof payload === "object") {
      if (entry.keys.length === 0) entry.keys = Object.keys(payload).slice(0, 8);
      const reason = (payload as { reason?: unknown }).reason;
      if (typeof reason === "string" && !entry.reasons.includes(reason)) entry.reasons.push(reason);
    }
  }
  broadcasts.set(event, entry);
});
type Rpc<T> = { ok: true; payload: T } | { ok: false; error: string };
async function rpc<T = Record<string, unknown>>(method: string, params: unknown = {}, timeoutMs = 45_000): Promise<Rpc<T>> {
  try {
    return { ok: true, payload: (await client.call(method, params, timeoutMs)) as T };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

// ---------------------------------------------------------------------------
// Stand-in model: an OpenAI-compatible endpoint that records what it is sent.
// A user message containing [[call:<tool>]] makes it call that tool once, if
// the tool was offered; [[force:<tool>]] makes it call the tool even though it
// was NOT offered (what a model does when it guesses a name).
// ---------------------------------------------------------------------------
interface ModelRequest {
  url: string;
  model: unknown;
  toolNames: string[];
  bodyKeys: string[];
  roles: string[];
  /** Everything the gateway itself put in front of the model: tool schemas + system prompt. */
  gatewayAuthoredText: string;
  /** Everything in user-role messages (the person's text, and runtime context). */
  userText: string;
  toolResults: string[];
}
const modelRequests: ModelRequest[] = [];
/** Whether the gateway under test runs OpenClaw Tool Search (set in setUp from the config). */
let toolSearch = false;
/** Words to search for a probe tool: the part after `__`, underscores as spaces. */
const searchQueryFor = (toolName: string) => (toolName.split("__").pop() ?? toolName).replace(/_/g, " ");
/** What the stand-in asks `exec` to print, to recognise the command's output in the tool result. */
const EXEC_MARKER = "FLATCLAW_PROBE_EXEC_OK";
const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((b) => (b as { text?: string })?.text ?? "").join("")
      : "";

const standIn = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "stand-in", object: "model", owned_by: "flatclaw-probe" }] }));
      return;
    }
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(body || "{}");
    } catch (err) {
      console.error("[stand-in] unparseable request body:", errText(err));
    }
    const tools = (json.tools as Array<{ function?: { name?: string }; name?: string }> | undefined) ?? [];
    const toolNames = tools.map((t) => t?.function?.name ?? t?.name).filter((n): n is string => !!n);
    const messages = (json.messages as Array<{ role: string; content: unknown }> | undefined) ?? [];
    const toolMessages = messages.filter((m) => m.role === "tool");
    modelRequests.push({
      url: req.url ?? "",
      model: json.model,
      toolNames,
      bodyKeys: Object.keys(json).sort(),
      roles: messages.map((m) => m.role),
      gatewayAuthoredText:
        JSON.stringify(tools) +
        messages.filter((m) => m.role === "system" || m.role === "developer").map((m) => textOf(m.content)).join("\n"),
      userText: messages.filter((m) => m.role === "user").map((m) => textOf(m.content)).join("\n"),
      toolResults: toolMessages.map((m) => textOf(m.content)),
    });
    // (toolResults above cover the whole session; checks slice per turn below.)
    if (!(req.url ?? "").includes("/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "the stand-in model only implements /v1/chat/completions" } }));
      return;
    }
    // The current turn: the last user message that is the person's text (the
    // gateway appends a runtime-context user message after it), and the tool
    // results that follow it. Earlier turns in the same session are ignored.
    const isPersonText = (m: { role: string; content: unknown }) => m.role === "user" && !textOf(m.content).includes("OPENCLAW_INTERNAL_CONTEXT");
    const lastUserIdx = messages.reduce((idx, m, i) => (isPersonText(m) ? i : idx), -1);
    const userText = lastUserIdx >= 0 ? textOf(messages[lastUserIdx].content) : "";
    const wanted = userText.match(/\[\[call:([^\]]+)\]\]/)?.[1];
    const forced = userText.match(/\[\[force:([^\]]+)\]\]/)?.[1];
    const search = userText.match(/\[\[search:([^\]]+)\]\]/)?.[1];
    const direct = userText.match(/\[\[tool:([a-z_0-9-]+)\s*(\{[\s\S]*?\})?\]\]/);
    const step = messages.slice(lastUserIdx + 1).filter((m) => m.role === "tool").length;
    const note = { note: "contract-probe" };
    // What the stand-in "model" does on this request. Direct mode: call the
    // tool by name. Tool Search mode: deferred tools are found with tool_search
    // and run through tool_call; the forced (other-agent) path searches too, so
    // the search results can be checked for leaks, then calls anyway.
    let planned: { name: string; args: Record<string, unknown> } | null = null;
    if (direct) {
      // [[tool:name {json}]]: one call with exactly these arguments, then text.
      // A deferred tool goes through tool_call when Tool Search is on.
      const args = JSON.parse(direct[2] ?? "{}") as Record<string, unknown>;
      if (step === 0) planned = toolNames.includes(direct[1]) || !toolSearch ? { name: direct[1], args } : { name: "tool_call", args: { id: direct[1], args } };
    } else if (search) {
      if (step === 0) planned = { name: "tool_search", args: { query: search, limit: 20 } };
    } else if (forced) {
      if (!toolSearch || toolNames.includes(forced)) {
        if (step === 0) planned = { name: forced, args: note };
      } else if (step === 0) planned = { name: "tool_search", args: { query: searchQueryFor(forced), limit: 20 } };
      else if (step === 1) planned = { name: "tool_call", args: { id: forced, args: note } };
    } else if (wanted) {
      const args = wanted === "exec" ? { command: `echo ${EXEC_MARKER}` } : note;
      if (toolNames.includes(wanted)) {
        if (step === 0) planned = { name: wanted, args };
      } else if (toolSearch) {
        if (step === 0) planned = { name: "tool_search", args: { query: searchQueryFor(wanted), limit: 20 } };
        else if (step === 1) planned = { name: "tool_call", args: { id: wanted, args } };
      }
    }
    const id = `chatcmpl-probe-${randomUUID().slice(0, 8)}`;
    const created = Math.floor(Date.now() / 1000);
    const model = json.model ?? "stand-in";
    const usage = { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 };
    const toolCall = planned
      ? { id: `call_probe_${randomUUID().slice(0, 6)}`, type: "function", function: { name: planned.name, arguments: JSON.stringify(planned.args) } }
      : null;
    if (json.stream) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const chunk = (delta: unknown, finish: string | null = null) =>
        res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      chunk({ role: "assistant", content: "" });
      if (toolCall) {
        chunk({ tool_calls: [{ index: 0, ...toolCall }] });
        chunk({}, "tool_calls");
      } else {
        chunk({ content: "PROBE_OK" });
        chunk({}, "stop");
      }
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [], usage })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    const message = toolCall
      ? { role: "assistant", content: null, tool_calls: [toolCall] }
      : { role: "assistant", content: "PROBE_OK" };
    res.end(JSON.stringify({ id, object: "chat.completion", created, model, choices: [{ index: 0, message, finish_reason: toolCall ? "tool_calls" : "stop" }], usage }));
  });
});

// ---------------------------------------------------------------------------
// One chat turn, observed from both ends.
// ---------------------------------------------------------------------------
interface TurnResult {
  ok: boolean;
  error?: string;
  sessionKey?: string;
  finalState?: string;
  finalText?: string;
  runIdMatchesIdempotencyKey?: boolean;
  chatStates: string[];
  events: Record<string, number>;
  toolEvents: Array<{ event: string; stream?: string; phase?: string; name?: string }>;
  requests: ModelRequest[];
}

function waitForFinal(sessionKey: string, timeoutMs: number) {
  const seen = { chatStates: [] as string[], events: {} as Record<string, number>, toolEvents: [] as TurnResult["toolEvents"] };
  let off: () => void = () => {};
  const done = new Promise<{ finalState?: string; finalText?: string; timedOut: boolean }>((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve({ timedOut: true });
    }, timeoutMs);
    off = client.on((event, payload) => {
      const p = (payload ?? {}) as {
        sessionKey?: string; state?: string; stream?: string; errorMessage?: string;
        message?: { content?: unknown };
        data?: { phase?: string; name?: string; tool?: string };
      };
      if (p.sessionKey !== sessionKey) return;
      seen.events[event] = (seen.events[event] ?? 0) + 1;
      if ((event === "agent" || event === "session.tool") && (p.stream === "tool" || p.stream === "exec")) {
        seen.toolEvents.push({ event, stream: p.stream, phase: p.data?.phase, name: p.data?.name ?? p.data?.tool });
      }
      if (event !== "chat" || typeof p.state !== "string") return;
      if (!seen.chatStates.includes(p.state)) seen.chatStates.push(p.state);
      if (["final", "error", "aborted"].includes(p.state)) {
        clearTimeout(timer);
        off();
        resolve({ timedOut: false, finalState: p.state, finalText: textOf(p.message?.content) || p.errorMessage });
      }
    });
  });
  return { done, seen };
}

async function runTurn(sessionKey: string, message: string): Promise<TurnResult> {
  const before = modelRequests.length;
  const { done, seen } = waitForFinal(sessionKey, 150_000);
  const idempotencyKey = randomUUID();
  const send = await rpc<{ runId?: string }>("chat.send", { sessionKey, message, idempotencyKey }, 60_000);
  if (!send.ok) return { ok: false, error: `chat.send: ${send.error}`, sessionKey, ...seen, requests: [] };
  const final = await done;
  await sleep(1_000); // let trailing utility requests land before slicing
  const base = { sessionKey, ...seen, requests: modelRequests.slice(before), runIdMatchesIdempotencyKey: send.payload.runId === idempotencyKey };
  if (final.timedOut) return { ok: false, error: "no final chat event within 150s", ...base };
  return { ok: final.finalState === "final", error: final.finalState === "final" ? undefined : `run ended ${final.finalState}: ${final.finalText}`, finalState: final.finalState, finalText: final.finalText, ...base };
}

async function createSession(agentId: string): Promise<string> {
  const created = await rpc<{ key?: string; sessionKey?: string; sessionId?: string }>("sessions.create", { agentId, model: MODEL_REF, label: `contract-probe-${Date.now()}` });
  if (!created.ok) throw new Error(`sessions.create(${agentId}): ${created.error}`);
  const key = created.payload.key ?? created.payload.sessionKey;
  if (!key) throw new Error(`sessions.create(${agentId}) returned no key (keys: ${keysOf(created.payload)})`);
  return key;
}

/** A turn for the JSON report, without the bulky prompt text. */
function summarize(turn: TurnResult) {
  return {
    ...turn,
    requests: turn.requests.map((r) => ({ url: r.url, model: r.model, tools: r.toolNames.length, roles: r.roles, bodyKeys: r.bodyKeys })),
  };
}

/** Tool names actually sent to the model during a turn, split by kind. */
function offeredTools(turn: TurnResult) {
  // The agent's own request is the one carrying tools; utility calls carry none.
  const names = [...new Set(turn.requests.flatMap((r) => r.toolNames))].sort();
  return { all: names, mcp: names.filter((n) => n.includes("__")), builtin: names.filter((n) => !n.includes("__")) };
}

/** The name prefix the gateway gives a server's tools (it truncates long server names). */
const gatewayToolPrefix = (serverName: string) => `${serverName.slice(0, GATEWAY_SERVER_NAME_MAX)}__`;

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
async function checkConnect(): Promise<boolean> {
  try {
    await client.connect();
  } catch (err) {
    record("connect.accepted", "fail", errText(err));
    return false;
  }
  const info = client.getServerInfo();
  report.server = info;
  record("connect.accepted", "pass", `backend client + device identity accepted by openclaw ${info?.version ?? "?"}`);
  const missingScopes = REQUIRED_SCOPES.filter((s) => !(info?.scopes ?? []).includes(s));
  expect("connect.scopes", missingScopes.length === 0, `all ${REQUIRED_SCOPES.length} operator scopes granted`, `scopes not granted: ${missingScopes.join(", ")}`);
  if (info?.version === OPENCLAW_VERIFIED_VERSION) record("gateway.version", "pass", `matches the pin (${OPENCLAW_VERIFIED_VERSION})`);
  else record("gateway.version", "warn", `gateway is ${info?.version}; lib/openclaw/version-pin.ts says ${OPENCLAW_VERIFIED_VERSION}`);
  const missingMethods = PORTAL_METHODS.filter((m) => !(info?.methods ?? []).includes(m) && !UNADVERTISED_OK.has(m));
  expect("surface.methods", missingMethods.length === 0, `${PORTAL_METHODS.length} portal RPC methods available (${info?.methods.length} advertised)`, `no longer advertised: ${missingMethods.join(", ")}`);
  const missingEvents = PORTAL_EVENTS.filter((e) => !(info?.events ?? []).includes(e));
  expect("surface.events", missingEvents.length === 0, `${PORTAL_EVENTS.length} portal events advertised`, `no longer advertised: ${missingEvents.join(", ")}`);
  return true;
}

async function checkBaseline(): Promise<void> {
  let snapshot = await readGatewayConfig();
  const entries = Object.keys(agentEntries(snapshot.blob));
  expect("config.roster-shape", !("list" in (snapshot.blob.agents ?? {})) && (entries.length <= 1 || snapshot.blob.agents?.ownership === "explicit"),
    `agents.entries with ${entries.length} agent(s), ownership=${snapshot.blob.agents?.ownership ?? "implicit"}`,
    `unexpected roster shape: keys=${keysOf(snapshot.blob.agents)}, ownership=${snapshot.blob.agents?.ownership}`);
  let drift = tenantBaselineDrift(snapshot.blob);
  if (drift.length > 0 && flag("--apply-baseline")) {
    await ensureTenantBaseline();
    snapshot = await readGatewayConfig();
    drift = tenantBaselineDrift(snapshot.blob);
    record("baseline.applied-now", "info", "wrote the tenant baseline (ensureTenantBaseline)");
  }
  expect("baseline.in-place", drift.length === 0, "tenant baseline is in the gateway config",
    `baseline keys missing or different: ${drift.join(", ")} — re-run with --apply-baseline, or restart the portal (it writes the baseline at boot)`);
  expect("config.noop-write", (await writeGatewayConfig(snapshot)) === false, "an unchanged document is not written back");
}

async function setUp(original: { raw: string }): Promise<void> {
  // Captured before the probe agents exist: clean-up deletes them through the
  // gateway and then puts this document back.
  original.raw = (await readGatewayConfig()).before;
  // Finish any deletion a previous, interrupted run left pending.
  for (const agentId of [OWNER, OTHER]) {
    const stale = await rpc("agents.delete", { agentId, deleteFiles: true }, 60_000);
    if (!stale.ok && !/not found/i.test(stale.error)) throw new Error(`could not clear a leftover ${agentId}: ${stale.error}`);
    if (stale.ok) await client.waitUntilReady();
  }
  const loadDelays: number[] = [];
  for (const agentId of [OWNER, OTHER]) {
    const created = await rpc("agents.create", { name: agentId, workspace: `${homedir()}/.openclaw/workspace-${agentId}` }, 60_000);
    if (!created.ok && !created.error.includes("already exists")) throw new Error(`agents.create(${agentId}): ${created.error}`);
    await client.waitUntilReady();
    // agents.create returns before the running gateway has loaded the agent;
    // provisioning waits the same way before it writes workspace files.
    const createdAt = Date.now();
    await waitForAgentLoaded(agentId);
    loadDelays.push(Date.now() - createdAt);
  }
  record("provision.agent-loaded", "pass", `a newly created agent is addressable ${Math.max(...loadDelays)} ms after agents.create returns (provisioning waits for it)`);
  const fixture = [option("--fixture"), "scripts/fixtures/contract-probe-mcp.mjs", "tools/contract-probe-mcp.mjs"]
    .filter((candidate): candidate is string => !!candidate)
    .map((candidate) => path.resolve(process.cwd(), candidate))
    .find((candidate) => existsSync(candidate));
  if (!fixture) throw new Error("stub MCP server (contract-probe-mcp.mjs) not found — run this from portal/, or pass --fixture <path>");
  registerManagedPrefix(PROBE_PREFIX);
  const snapshot = await readGatewayConfig();
  const blob = snapshot.blob as ConfigBlob & { models?: { providers?: Record<string, unknown> } };
  blob.models = blob.models ?? {};
  blob.models.providers = blob.models.providers ?? {};
  blob.models.providers[PROVIDER] = {
    baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, apiKey: "no-auth-needed", api: "openai-completions", timeoutSeconds: 120,
    models: [{ id: "stand-in", name: "Contract probe stand-in", api: "openai-completions", contextWindow: 262144, maxTokens: 1024, reasoning: false, input: ["text"], compat: { supportsTools: true } }],
  };
  const policy = (blob.agents?.defaults as { modelPolicy?: { allow?: string[] } } | undefined)?.modelPolicy;
  if (Array.isArray(policy?.allow) && !policy.allow.includes(MODEL_REF)) policy.allow.push(MODEL_REF);
  blob.mcp = blob.mcp ?? {};
  blob.mcp.servers = blob.mcp.servers ?? {};
  for (const owner of [OWNER, LONG_OWNER]) {
    blob.mcp.servers[managedServerName(PROBE_PREFIX, owner)] = { command: "node", args: [fixture], env: { OPENCLAW_AGENT_ID: owner } };
  }
  // Exactly what the portal does after registering a managed server.
  // The probe agents must deny every real server on this gateway too, not only
  // the probe's own: a prefix is everything up to and including the first "-".
  for (const name of Object.keys(blob.mcp.servers)) {
    const dash = name.indexOf("-");
    if (dash > 0) registerManagedPrefix(name.slice(0, dash + 1));
  }
  const toolSearchFlag = option("--tool-search");
  if (toolSearchFlag === "on" || toolSearchFlag === "off") {
    const toolsNode = ((blob as Record<string, unknown>).tools ??= {}) as Record<string, unknown>;
    toolsNode.toolSearch = toolSearchFlag === "on";
  }
  toolSearch = toolSearchEnabled(blob);
  applyManagedToolPolicies(blob);
  await writeGatewayConfig(snapshot);
  // The model catalog is rebuilt asynchronously after a provider is added.
  let listed = false;
  for (let i = 0; i < 30 && !listed; i++) {
    const models = await rpc<{ models?: Array<{ provider?: string; id?: string }> }>("models.list", {});
    listed = models.ok && (models.payload.models ?? []).some((m) => `${m.provider}/${m.id}` === MODEL_REF);
    if (!listed) await sleep(1_000);
  }
  if (!listed) throw new Error(`the gateway never listed ${MODEL_REF} after it was registered and allow-listed`);

  const after = (await readGatewayConfig()).blob;
  const ownServer = managedServerName(PROBE_PREFIX, OWNER);
  const longServer = managedServerName(PROBE_PREFIX, LONG_OWNER);
  const otherDeny = findAgentEntry(after, OTHER)?.tools?.deny ?? [];
  const ownerDeny = findAgentEntry(after, OWNER)?.tools?.deny ?? [];
  expect("isolation.deny-written",
    otherDeny.includes(denyPatternForServer(ownServer)) && otherDeny.includes(denyPatternForServer(longServer)) &&
      ownerDeny.includes(denyPatternForServer(longServer)) && !ownerDeny.includes(denyPatternForServer(ownServer)),
    "the gateway stored the computed deny globs on both probe agents",
    `stored deny lists are wrong — other: ${JSON.stringify(otherDeny)} owner: ${JSON.stringify(ownerDeny)}`);
}

async function checkIsolation(): Promise<void> {
  const ownServer = managedServerName(PROBE_PREFIX, OWNER);
  const longServer = managedServerName(PROBE_PREFIX, LONG_OWNER);
  const ownTool = `${ownServer}__echo_approval`;

  // --- the owner: sees (or finds) its own server, calls it, and the envelope survives ---
  record("mode.tool-search", "info", toolSearch
    ? "Tool Search is ON: MCP tools are reached through tool_search / tool_describe / tool_call"
    : "Tool Search is OFF: MCP tools are offered directly as <server>__<tool>");
  const ownerKey = await createSession(OWNER);
  const ownerTurn = await runTurn(ownerKey, `Contract probe. [[call:${ownTool}]] Then reply PROBE_OK.`);
  report.ownerTurn = summarize(ownerTurn);
  expect("turn.completes", ownerTurn.ok, `run reached final (${ownerTurn.chatStates.join(" → ")})`, ownerTurn.error);
  expect("turn.run-id", ownerTurn.runIdMatchesIdempotencyKey === true, "runId equals the chat.send idempotencyKey (chat.abort relies on it)");
  const agentRequest = ownerTurn.requests.find((r) => r.toolNames.length > 0);
  expect("model.route", !!agentRequest && agentRequest.url.includes("/chat/completions"),
    `openai-completions route: POST ${agentRequest?.url} with [${agentRequest?.bodyKeys.join(", ")}]`,
    `the agent request never reached the stand-in with tools (urls seen: ${ownerTurn.requests.map((r) => r.url).join(", ") || "none"})`);
  const utility = ownerTurn.requests.filter((r) => r.toolNames.length === 0);
  record("model.extra-requests", utility.length === 0 ? "pass" : "warn",
    utility.length === 0 ? "no utility-model requests beside the agent's own" : `${utility.length} extra tool-less request(s) per turn (utility model: titles / narration) for model(s) ${[...new Set(utility.map((r) => String(r.model)))].join(", ")}`);

  const owner = offeredTools(ownerTurn);
  const ownerResults = ownerTurn.requests.flatMap((r) => r.toolResults);
  if (toolSearch) {
    // Direct tools are the core primitives plus the three controls; the rest of
    // the expected roster is listed in the deferred directory of the prompt.
    const allowedDirect = new Set<string>([...TOOL_SEARCH_DIRECT_TOOLS, ...OPTIONAL_BUILTIN_TOOLS]);
    const unexpected = owner.builtin.filter((t) => !allowedDirect.has(t));
    const missingDirect = TOOL_SEARCH_DIRECT_TOOLS.filter((t) => !owner.builtin.includes(t));
    expect("tools.builtin-roster", unexpected.length === 0 && missingDirect.length === 0,
      `${owner.builtin.length} tools offered directly under Tool Search: the core primitives and tool_search / tool_describe / tool_call`,
      `direct roster drifted — unexpected: [${unexpected.join(", ")}] missing: [${missingDirect.join(", ")}]. Decide in lib/openclaw/tenant-baseline.ts or tool-call-wrapper.ts.`);
    const directory = new Set((agentRequest?.gatewayAuthoredText ?? "").split("\n").map((line) => /^- ([a-z_0-9]+) \(/.exec(line)?.[1]).filter((n): n is string => !!n));
    const notListed = EXPECTED_BUILTIN_TOOLS.filter((t) => !owner.builtin.includes(t) && !directory.has(t));
    expect("tools.deferred-directory", directory.size > 0 && notListed.length === 0,
      `the prompt's deferred-tool directory lists ${directory.size} tools; every expected built-in is direct or listed`,
      directory.size === 0 ? "no deferred-tool directory found in the system prompt" : `expected built-ins neither offered nor listed in the directory: ${notListed.join(", ")}`);
  } else {
    const unexpected = owner.builtin.filter((t) => !EXPECTED_BUILTIN_TOOLS.includes(t) && !OPTIONAL_BUILTIN_TOOLS.includes(t));
    const missing = EXPECTED_BUILTIN_TOOLS.filter((t) => !owner.builtin.includes(t));
    const optional = owner.builtin.filter((t) => OPTIONAL_BUILTIN_TOOLS.includes(t));
    expect("tools.builtin-roster", unexpected.length === 0 && missing.length === 0,
      `${owner.builtin.length} built-in tools offered: the ${EXPECTED_BUILTIN_TOOLS.length} expected${optional.length ? ` plus optional ${optional.join(", ")}` : ""}`,
      `built-in roster drifted — unexpected: [${unexpected.join(", ")}] missing: [${missing.join(", ")}]. Decide in lib/openclaw/tenant-baseline.ts.`);
  }
  // The turn above only shows what this gateway offers as configured today.
  // The catalog is every tool it knows, whatever the profile or providers.
  const catalog = (await client.call("tools.catalog", { agentId: OWNER })) as { groups?: Array<{ tools?: Array<{ id?: string }> }> };
  const catalogIds = (catalog.groups ?? []).flatMap((g) => g.tools ?? []).map((t) => t.id ?? "").filter((id) => id && !id.includes("__"));
  const undecided = [...new Set(catalogIds)].filter((id) => builtinToolDecision(id) === "undecided" && !(TOOL_SEARCH_CONTROL_IDS.has(id)));
  expect("tools.catalog-decided", catalogIds.length > 0 && undecided.length === 0,
    `all ${new Set(catalogIds).size} built-in and plugin tools in the gateway's catalog are decided in tenant-baseline.ts`,
    catalogIds.length === 0 ? "tools.catalog returned no tools" : `the gateway knows tools tenant-baseline.ts has not decided: [${undecided.join(", ")}]. Add each to the expected, optional or denied list.`);
  const deniedButOffered = owner.builtin.filter((t) => DENIED_BUILTIN_TOOLS.includes(t));
  expect("tools.global-deny", deniedButOffered.length === 0, "none of the tenant-denied built-ins is offered", `tenant-denied tools still offered: ${deniedButOffered.join(", ")}`);
  if (toolSearch) {
    const searchHit = ownerResults.some((t) => t.includes(`"name": "${ownTool}"`) || t.includes(`"name":"${ownTool}"`));
    expect("tools.search-finds-own", searchHit, `tool_search returns the agent's own MCP tool (${ownTool})`,
      `tool_search did not return ${ownTool}; results: ${JSON.stringify(ownerResults[0]?.slice(0, 200) ?? "none")}`);
    const called = ownerResults.map((t) => unwrapToolResult("tool_call", t)).find((u) => u.targetName === ownTool);
    expect("tools.call-through-wrapper", !!called && !called.error && called.text.includes("PENDING_HUMAN_APPROVAL"),
      `tool_call runs the MCP tool and returns its result inside the {tool, result} envelope`,
      `tool_call did not return the tool's result: ${JSON.stringify(ownerResults.slice(-1)[0]?.slice(0, 200) ?? "none")}`);
  } else {
    expect("tools.direct-mcp", owner.mcp.includes(ownTool),
      `MCP tools are offered directly as <server>__<tool> (${ownTool})`,
      `own MCP tool ${ownTool} was not offered (mcp tools offered: ${owner.mcp.join(", ") || "none"}; control tools: ${owner.builtin.filter((t) => t.startsWith("tool_")).join(", ") || "none"})`);
  }
  const longPrefix = gatewayToolPrefix(longServer);
  const foreign = toolSearch
    ? ownerResults.filter((t) => t.includes(longPrefix) || t.includes(`${longServer}__`)).map(() => `${longPrefix}* (in tool_search results)`)
    : owner.mcp.filter((t) => t.startsWith(longPrefix) || t.startsWith(`${longServer}__`));
  expect("isolation.long-server-name", foreign.length === 0,
    `a ${longServer.length}-character server name owned by someone else stays hidden${toolSearch ? " from tool_search" : ""}`,
    `tools of another user's server are ${toolSearch ? "returned by tool_search" : "offered"}: ${[...new Set(foreign)].join(", ")} — the gateway shortens server names to ${GATEWAY_SERVER_NAME_MAX} characters, so the deny glob "${denyPatternForServer(longServer)}" no longer matches`);

  // --- approvals contract: what lib/openclaw/approvals.ts reads back ---------
  const history = await rpc<{ messages?: Array<Record<string, unknown>> }>("chat.history", { sessionKey: ownerKey });
  if (!history.ok) record("approvals.transcript", "fail", `chat.history: ${history.error}`);
  else {
    const messages = history.payload.messages ?? [];
    const shapes = messages.map((m) => `${m.role}:${typeof m.content === "string" ? "string" : Array.isArray(m.content) ? "blocks" : typeof m.content}`);
    report.historyShapes = shapes;
    report.historyMessageFields = [...new Set(messages.flatMap((m) => Object.keys(m)))].sort();
    // The block that called the MCP tool: by name directly, or a tool_call
    // wrapper whose arguments name it (approvals.ts unwraps the same way).
    const call = messages
      .filter((m) => String(m.role).toLowerCase() !== "custom")
      .flatMap((m) => (Array.isArray(m.content) ? (m.content as Array<Record<string, unknown>>) : []))
      .find((b) => /tool_?call/i.test(String(b.type)) && typeof b.id === "string" && unwrapToolCall(String(b.name ?? ""), b.arguments).name === ownTool);
    const result = call ? messages.find((m) => String(m.role).toLowerCase() === "toolresult" && m.toolCallId === call.id) : undefined;
    let envelope: { status?: string; approval?: { kind?: string } } | null = null;
    let unwrapped: { text: string; targetName?: string; error?: string } = { text: "" };
    if (result) {
      unwrapped = unwrapToolResult(String(result.toolName ?? ""), textOf(result.content));
      try {
        envelope = JSON.parse(unwrapped.text);
      } catch (err) {
        report.approvalParseError = errText(err);
      }
    }
    report.toolResultSample = unwrapped.text.slice(0, 400);
    const resultNamesTool = !!result && (toolSearch ? unwrapped.targetName === ownTool : result.toolName === ownTool);
    expect("approvals.transcript",
      !!call && !!result && resultNamesTool && !unwrapped.error && envelope?.status === "PENDING_HUMAN_APPROVAL",
      toolSearch
        ? "the tool_call block names the MCP tool, its result unwraps to the tool's own text, and that text is the approval JSON verbatim"
        : "toolCall block and toolResult message link up, and the MCP result text is the approval JSON verbatim",
      `transcript no longer matches what approvals.ts parses — toolCall: ${JSON.stringify(call ? { type: call.type, name: call.name, id: call.id } : null)}, toolResult: ${JSON.stringify(result ? { toolCallId: result.toolCallId, toolName: result.toolName } : null)}, unwrapped target: ${unwrapped.targetName ?? "none"}, error: ${unwrapped.error ?? "none"}, result text starts: ${JSON.stringify(unwrapped.text.slice(0, 120))}`);
    expect("transcript.shapes", shapes.some((s) => s === "user:string" || s === "user:blocks") && shapes.includes("assistant:blocks"),
      `chat.history shapes: ${[...new Set(shapes)].join(", ")}`);
  }
  const named = ownerTurn.toolEvents.filter((e) => e.name === ownTool);
  expect("events.tool-stream", named.some((e) => /start/.test(String(e.phase))) && named.some((e) => /end|result|complete/.test(String(e.phase))),
    `live tool events carry the flattened name with start and end phases (${[...new Set(named.map((e) => `${e.event}/${e.stream}/${e.phase}`))].join(", ")})`,
    `tool events for ${ownTool} are missing or changed shape: ${JSON.stringify(ownerTurn.toolEvents.slice(0, 6))}`);

  // --- exec: agents run shell commands on a tenant with nobody there to approve
  // them. A default that started asking for approval would park every such run.
  const execKey = await createSession(OWNER);
  const execTurn = await runTurn(execKey, "Contract probe. [[call:exec]] Then reply PROBE_OK.");
  const execResult = execTurn.requests.flatMap((r) => r.toolResults).find((t) => t.length > 0) ?? "";
  expect("turn.exec", execTurn.ok && execResult.includes(EXEC_MARKER),
    "exec ran on the gateway host and returned its output, with no approval step",
    `exec did not run to completion (${execTurn.error ?? execTurn.chatStates.join(" → ")}); tool result: ${JSON.stringify(execResult.slice(0, 300))}`);
  await rpc("sessions.delete", { key: execKey });

  // The portal relays these events to a browser only when they name one of the
  // viewer's own sessions (lib/openclaw/stream-events.ts). An event that
  // carries conversation content must therefore always name its session, or it
  // would silently vanish from the chat page. `sessions.changed` is the one
  // mixed case: the gateway also uses it for gateway-wide notices with only a
  // `reason` (runner availability, scheduler bindings); those are not relayed.
  const contentEvents = RELAYED_GATEWAY_EVENTS.filter((name) => name !== "sessions.changed");
  const unkeyed = contentEvents.filter((name) => (broadcasts.get(name)?.withoutKey ?? 0) > 0);
  const contentSeen = contentEvents.filter((name) => broadcasts.has(name));
  const changed = broadcasts.get("sessions.changed");
  expect("events.session-scoped", contentSeen.length > 0 && unkeyed.length === 0 && (changed?.withKey ?? 0) > 0,
    `every content event carries a sessionKey (${contentSeen.map((n) => `${n}×${broadcasts.get(n)?.withKey}`).join(", ")}); sessions.changed names its session ${changed?.withKey ?? 0}× and came ${changed?.withoutKey ?? 0}× as a gateway-wide notice (${changed?.reasons.join(", ") || "none"}), which is not relayed`,
    contentSeen.length === 0 ? "none of the relayed content events was observed"
      : unkeyed.length > 0 ? `content events arrived without a sessionKey and would be dropped: ${unkeyed.map((n) => `${n} (${broadcasts.get(n)?.withoutKey}×, keys: ${broadcasts.get(n)?.keys.join("/")})`).join("; ")}`
      : "no sessions.changed event named a session");

  // --- sessions surface, on the session that just ran ------------------------
  const usage = await rpc<{ sessions?: Array<{ contextWeight?: Record<string, unknown>; usage?: Record<string, unknown> }> }>("sessions.usage", { key: ownerKey, includeContextWeight: true });
  const usageEntry = usage.ok ? usage.payload.sessions?.[0] : undefined;
  expect("sessions.usage", usage.ok && !!usageEntry?.contextWeight,
    `sessions.usage returns contextWeight {${keysOf(usageEntry?.contextWeight).join(", ")}} and usage {${keysOf(usageEntry?.usage).join(", ")}}`,
    usage.ok ? `sessions.usage has no contextWeight (entry keys: ${keysOf(usageEntry).join(", ")})` : `sessions.usage: ${usage.error}`);
  const described = await rpc<{ session?: Record<string, unknown> }>("sessions.describe", { key: ownerKey });
  expect("sessions.describe", described.ok && !!described.payload.session,
    `sessions.describe → session {${keysOf(described.ok ? described.payload.session : null).slice(0, 12).join(", ")}…}`, described.ok ? "no session in the reply" : described.error);
  report.sessionDescribe = described.ok ? { contextTokens: described.payload.session?.contextTokens ?? null, keys: keysOf(described.payload.session) } : null;
  const listed = await rpc<{ sessions?: Array<Record<string, unknown>> }>("sessions.list", { agentId: OWNER, includeDerivedTitles: true, includeLastMessage: true });
  const row = listed.ok ? (listed.payload.sessions ?? []).find((s) => (s.key ?? s.sessionKey) === ownerKey) : undefined;
  expect("sessions.list", !!row, `sessions.list rows carry {${keysOf(row).filter((k) => ["key", "sessionKey", "label", "displayName", "derivedTitle", "updatedAt", "lastMessagePreview", "contextTokens", "totalTokensFresh"].includes(k)).join(", ")}}`,
    listed.ok ? "the session that just ran is not in sessions.list" : listed.error);
  const patched = await rpc("sessions.patch", { key: ownerKey, label: "contract probe (renamed)" });
  expect("sessions.patch", patched.ok, "rename via sessions.patch {key, label}", patched.ok ? undefined : patched.error);
  const compacted = await rpc("sessions.compact", { key: ownerKey }, 120_000);
  record("sessions.compact", compacted.ok ? "pass" : "warn", compacted.ok ? "sessions.compact accepted" : `sessions.compact on a two-turn session: ${compacted.error}`);
  const deleted = await rpc("sessions.delete", { key: ownerKey });
  expect("sessions.delete", deleted.ok, "sessions.delete {key}", deleted.ok ? undefined : deleted.error);

  // --- the other agent: none of it -------------------------------------------
  const otherKey = await createSession(OTHER);
  // [[force:…]]: the stand-in calls the owner's tool although it is not on the
  // other agent's roster — the gateway must refuse to run it. Under Tool
  // Search it searches for the tool first, so the results can be checked too.
  const otherTurn = await runTurn(otherKey, `Contract probe. [[force:${ownTool}]] Then reply PROBE_OK.`);
  report.otherTurn = summarize(otherTurn);
  const other = offeredTools(otherTurn);
  const leaked = other.mcp.filter((t) => t.startsWith(PROBE_PREFIX));
  const mentions = otherTurn.requests.reduce((n, r) => n + (r.gatewayAuthoredText.split(PROBE_PREFIX).length - 1), 0);
  const otherResults = otherTurn.requests.flatMap((r) => r.toolResults);
  // In Tool Search mode the first tool result is the search; the gateway's
  // error for the forced call echoes the id the model asked for, so only the
  // search results are checked for the owner's names.
  const searchLeak = toolSearch && otherResults.length > 0 && otherResults[0].includes(PROBE_PREFIX);
  expect("isolation.other-agent", leaked.length === 0 && mentions === 0 && !searchLeak && otherTurn.requests.length > 0,
    `another agent is offered 0 of the owner's MCP tools${toolSearch ? ", tool_search returns none of them" : ""}, and the server names appear nowhere in the tool schemas or system prompt of its ${otherTurn.requests.length} request(s)`,
    `cross-user leak — tools offered: [${leaked.join(", ")}], mentions of "${PROBE_PREFIX}" in tool schemas/system prompt: ${mentions}, in tool_search results: ${searchLeak}, requests seen: ${otherTurn.requests.length}`);
  // Each request carries every tool result so far; the last one is the forced call's.
  const forcedResults = toolSearch ? otherResults.slice(-1) : otherResults;
  report.forcedCallResult = forcedResults.map((t) => t.slice(0, 300));
  expect("isolation.call-time", forcedResults.length > 0 && !forcedResults.some((t) => t.includes("PENDING_HUMAN_APPROVAL")),
    `a forced call to the owner's tool from another agent did not execute (${forcedResults.length ? `gateway answered: ${JSON.stringify(forcedResults[0].slice(0, 90))}` : `run ended ${otherTurn.finalState ?? otherTurn.error}`})`,
    forcedResults.length === 0 ? `no forced call was made (run ended ${otherTurn.finalState ?? otherTurn.error})` : "a tool that was never offered to this agent EXECUTED when the model called it by name");
  await rpc("sessions.delete", { key: otherKey });

  // --- existing agents the operator asked about ------------------------------
  if (EXTRA_AGENTS.length > 0) {
    const cfg = (await readGatewayConfig()).blob;
    const servers = Object.keys(cfg.mcp?.servers ?? {});
    for (const agentId of EXTRA_AGENTS) {
      const deny = findAgentEntry(cfg, agentId)?.tools?.deny ?? [];
      const denied = servers.filter((s) => deny.includes(denyPatternForServer(s)));
      let key: string;
      try {
        key = await createSession(agentId);
      } catch (err) {
        record(`isolation.agent:${agentId}`, "fail", errText(err));
        continue;
      }
      if (toolSearch) {
        // Nothing is offered by name under Tool Search. Search for every server
        // this agent must not see, by name; none of their tools may come back.
        const query = denied.map((s) => s.replace(/^[a-z]+-/, "").replace(/-/g, " ")).join(" ") || "nothing";
        const turn = await runTurn(key, `Contract probe. [[search:${query}]] Then reply PROBE_OK.`);
        const results = turn.requests.flatMap((r) => r.toolResults).join("\n");
        const visible = denied.filter((s) => results.includes(`"name": "${gatewayToolPrefix(s)}`) || results.includes(`"name":"${gatewayToolPrefix(s)}`));
        expect(`isolation.agent:${agentId}`, turn.ok && visible.length === 0,
          `denies ${denied.length} server(s); a tool_search for their names returns none of their tools`,
          turn.ok ? `tool_search returned tools of servers it must not see: ${visible.join(", ")}` : `turn failed: ${turn.error}`);
      } else {
        const turn = await runTurn(key, "Contract probe. Reply PROBE_OK.");
        const offered = offeredTools(turn);
        const visible = offered.mcp.filter((t) => denied.some((s) => t.startsWith(gatewayToolPrefix(s))));
        const ownServers = [...new Set(offered.mcp.map((t) => t.split("__")[0]))];
        expect(`isolation.agent:${agentId}`, turn.ok && visible.length === 0,
          `denies ${denied.length} server(s) and is offered none of their tools; sees ${offered.mcp.length} MCP tool(s) from [${ownServers.join(", ") || "no server"}]`,
          turn.ok ? `offered tools from servers it must not see: ${visible.slice(0, 8).join(", ")}` : `turn failed: ${turn.error}`);
      }
      await rpc("sessions.delete", { key });
    }
  }
}

/**
 * The session tools (`sessions_history`, `sessions_send`, `sessions_spawn`,
 * `sessions_list`) stay on the roster because an agent needs them for its own
 * sub-agents. With `tools.sessions.visibility: "tree"` and the default spawn
 * targets they must not reach another agent's sessions. Checked by effect: the
 * other agent reads, writes, spawns and lists against the owner, and nothing
 * of the owner's comes back or changes.
 */
async function checkSessionIsolation(): Promise<void> {
  const SECRET = `OWNER_SECRET_${randomUUID().slice(0, 8)}`;
  const INTRUDER = `INTRUDER_${randomUUID().slice(0, 8)}`;
  const ownerKey = await createSession(OWNER);
  const seed = await runTurn(ownerKey, `Contract probe. Remember the code ${SECRET}. Reply PROBE_OK.`);
  if (!seed.ok) { record("isolation.sessions", "fail", `could not seed the owner's session: ${seed.error}`); return; }
  const ownerKeysBefore = async () => {
    const r = await rpc<{ sessions?: Array<{ key?: string; sessionKey?: string }> }>("sessions.list", { agentId: OWNER });
    return r.ok ? (r.payload.sessions ?? []).map((x) => String(x.key ?? x.sessionKey)) : [];
  };
  const attempt = async (id: string, tool: string, args: Record<string, unknown>) => {
    // A fresh session per attempt, so each turn's tool result is unmistakable.
    const otherKey = await createSession(OTHER);
    const turn = await runTurn(otherKey, `Contract probe. [[tool:${tool} ${JSON.stringify(args)}]] Then reply PROBE_OK.`);
    const result = turn.requests.flatMap((r) => r.toolResults).slice(-1)[0] ?? "";
    const called = turn.toolEvents.some((e) => e.name === tool);
    report[`sessionIsolation.${id}`] = { ok: turn.ok, called, result: result.slice(0, 300) };
    await rpc("sessions.delete", { key: otherKey });
    return { turn, result, called };
  };
  const read = await attempt("history", "sessions_history", { sessionKey: ownerKey });
  expect("isolation.sessions-history", read.turn.ok && read.called && !read.result.includes(SECRET),
    `sessions_history on another agent's session returns none of its content (gateway: ${JSON.stringify(read.result.slice(0, 80))})`,
    read.turn.ok ? `another agent READ the owner's session: ${JSON.stringify(read.result.slice(0, 200))}` : `turn failed: ${read.turn.error}`);
  const write = await attempt("send", "sessions_send", { sessionKey: ownerKey, message: INTRUDER });
  const ownerHistory = await rpc<{ messages?: Array<{ content?: unknown }> }>("chat.history", { sessionKey: ownerKey });
  const ownerText = ownerHistory.ok ? JSON.stringify(ownerHistory.payload.messages ?? []) : "";
  expect("isolation.sessions-send", write.turn.ok && write.called && ownerHistory.ok && !ownerText.includes(INTRUDER),
    `sessions_send into another agent's session is refused (gateway: ${JSON.stringify(write.result.slice(0, 80))})`,
    write.turn.ok ? `another agent WROTE into the owner's session (${JSON.stringify(write.result.slice(0, 200))})` : `turn failed: ${write.turn.error}`);
  const before = await ownerKeysBefore();
  const spawn = await attempt("spawn", "sessions_spawn", { task: `Say ${INTRUDER}.`, agentId: OWNER });
  await sleep(2_000);
  const after = await ownerKeysBefore();
  const spawned = after.filter((k) => !before.includes(k));
  expect("isolation.sessions-spawn", spawn.turn.ok && spawn.called && spawned.length === 0,
    `sessions_spawn targeting another agent is refused (gateway: ${JSON.stringify(spawn.result.slice(0, 80))})`,
    spawn.turn.ok ? `another agent SPAWNED a session on the owner: ${spawned.join(", ") || JSON.stringify(spawn.result.slice(0, 200))}` : `turn failed: ${spawn.turn.error}`);
  const list = await attempt("list", "sessions_list", { agentId: OWNER });
  expect("isolation.sessions-list", list.turn.ok && list.called && !list.result.includes(`agent:${OWNER}:`),
    `sessions_list for another agent returns none of its sessions`,
    list.turn.ok ? `another agent LISTED the owner's sessions: ${JSON.stringify(list.result.slice(0, 200))}` : `turn failed: ${list.turn.error}`);
  await rpc("sessions.delete", { key: ownerKey });
}

async function checkPortalSessionFlow(): Promise<void> {
  // The chat panel talks to keys it builds itself: agent:<id>:main and
  // agent:<id>:<sessionId from sessions.create>. Both must be usable as-is.
  const patched = await readGatewayConfig();
  const entry = findAgentEntry(patched.blob, OWNER);
  if (entry) (entry as Record<string, unknown>).model = MODEL_REF; // these keys carry no per-session model
  await writeGatewayConfig(patched);

  const created = await rpc<{ key?: string; sessionKey?: string; sessionId?: string }>("sessions.create", { agentId: OWNER });
  expect("sessions.create", created.ok && typeof created.payload.sessionId === "string",
    `sessions.create {agentId} → {${keysOf(created.ok ? created.payload : null).join(", ")}}`, created.ok ? "no sessionId in the reply" : created.error);
  for (const [id, key] of [
    ["chat.portal-built-key", created.ok ? `agent:${OWNER}:${created.payload.sessionId}` : null],
    ["chat.main-key", `agent:${OWNER}:main`],
  ] as const) {
    if (!key) continue;
    const turn = await runTurn(key, "Contract probe. Reply PROBE_OK.");
    expect(id, turn.ok, `chat.send to ${key.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, "<uuid>")} runs and completes`, turn.error);
    if (id === "chat.portal-built-key") {
      const abort = await rpc("chat.abort", { sessionKey: key });
      expect("chat.abort", abort.ok, "chat.abort {sessionKey} accepted with no run in flight", abort.ok ? undefined : abort.error);
      await rpc("sessions.delete", { key });
    }
  }
  if (created.ok && created.payload.key) await rpc("sessions.delete", { key: created.payload.key });
}

async function checkProvisioning(): Promise<void> {
  const workspace = `${homedir()}/.openclaw/workspace-${OWNER}`;
  report.workspaceBootstrap = existsSync(workspace) ? readdirSync(workspace).sort() : null;
  const failed: string[] = [];
  for (const name of PORTAL_WORKSPACE_FILES) {
    const set = await rpc("agents.files.set", { agentId: OWNER, name, content: `# probe ${name}\n` });
    if (!set.ok) failed.push(`${name}: ${set.error}`);
  }
  expect("provision.files-set", failed.length === 0, `agents.files.set accepts ${PORTAL_WORKSPACE_FILES.join(", ")}`, failed.join(" | "));
  const got = await rpc<{ file?: { content?: string; missing?: boolean } }>("agents.files.get", { agentId: OWNER, name: "AGENTS.md" });
  expect("provision.files-get", got.ok && got.payload.file?.content === "# probe AGENTS.md\n", "agents.files.get round-trips the content", got.ok ? `unexpected file payload: ${JSON.stringify(got.payload.file).slice(0, 160)}` : got.error);
  const retired: string[] = [];
  for (const name of ["TOOLS.md", "HEARTBEAT.md"]) {
    const set = await rpc("agents.files.set", { agentId: OWNER, name, content: "# probe\n" });
    if (set.ok) retired.push(name);
  }
  record("provision.retired-files", retired.length === 0 ? "pass" : "warn",
    retired.length === 0 ? "TOOLS.md and HEARTBEAT.md are rejected, as the portal now assumes" : `${retired.join(", ")} accepted again — the portal folds their content into AGENTS.md`);

  // Scheduled tasks: the exact shapes app/api/portal/scheduled-tasks sends.
  const at = new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString();
  const added = await rpc<{ id?: string }>("cron.add", {
    agentId: OWNER, name: "contract-probe", description: "temporary", enabled: true, deleteAfterRun: true,
    schedule: { kind: "at", at }, sessionTarget: "isolated", wakeMode: "now",
    payload: { kind: "agentTurn", message: "noop", thinking: "medium" }, delivery: { mode: "none" },
  });
  const jobId = added.ok ? added.payload.id : undefined;
  if (!expect("cron.add", typeof jobId === "string", "cron.add accepts the portal's job shape", added.ok ? "no id in the reply" : added.error)) return;
  const updated = await rpc("cron.update", { id: jobId, patch: { enabled: false, name: "contract-probe-2", schedule: { kind: "cron", expr: "0 9 * * 1", tz: "UTC" }, delivery: { mode: "announce" } } });
  expect("cron.update", updated.ok, "cron.update accepts the portal's patch shape", updated.ok ? undefined : updated.error);
  const listed = await rpc<{ jobs?: Array<Record<string, unknown>> }>("cron.list", { includeDisabled: true, sortBy: "nextRunAtMs", sortDir: "asc", limit: 200 });
  const jobs = listed.ok ? listed.payload.jobs ?? [] : [];
  const job = jobs.find((j) => j.id === jobId);
  expect("cron.list", !!job && job.agentId === OWNER && (job.schedule as { kind?: string } | undefined)?.kind === "cron",
    `cron.list returns the job with {${keysOf(job).join(", ")}}`, listed.ok ? "the job just added is not listed" : listed.error);
  // The gateway keeps monitor jobs of its own on every agent. The portal hides
  // them by declarationKey (lib/scheduler/server.ts); under the tenant baseline
  // the per-agent skill review must also be disabled, or it spends GPU time.
  const foreign = jobs.filter((j) => j.id !== jobId && [OWNER, OTHER].includes(String(j.agentId)));
  report.gatewayOwnedJobs = foreign.map((j) => ({ name: j.name, declarationKey: j.declarationKey ?? null, enabled: j.enabled }));
  const visible = foreign.filter((j) => !isGatewayOwnedJob(j));
  const running = foreign.filter((j) => String(j.declarationKey ?? "").startsWith("skill-collection-review:") && j.enabled !== false);
  expect("cron.gateway-owned-jobs", visible.length === 0 && running.length === 0,
    `${foreign.length} gateway-owned job(s) on the probe agents, all hidden from Scheduled Tasks and the skill review disabled`,
    `${visible.length ? `jobs the portal would show as user tasks: ${visible.map((j) => `${j.name} (declarationKey=${j.declarationKey ?? "none"})`).join(", ")}. ` : ""}${running.length ? `skill reviews still enabled: ${running.map((j) => j.name).join(", ")}` : ""}`);
  // A scheduled task's text is written by a user too. It has to reach the agent
  // as text: a task that says "/status" must not be run by the gateway as a
  // command (commands run with owner rights; see lib/openclaw/chat-commands.ts).
  const slashMarker = "/status";
  const requestsBefore = modelRequests.length;
  const slash = await rpc<{ id?: string }>("cron.add", {
    agentId: OWNER, name: "contract-probe-slash", description: "temporary", enabled: true, deleteAfterRun: true,
    schedule: { kind: "at", at }, sessionTarget: "isolated", wakeMode: "now",
    payload: { kind: "agentTurn", message: slashMarker, thinking: "medium" }, delivery: { mode: "none" },
  });
  if (slash.ok && typeof slash.payload.id === "string") {
    const ran = await rpc("cron.run", { id: slash.payload.id, mode: "force" }, 60_000);
    let reached = false;
    for (let i = 0; ran.ok && i < 80 && !reached; i++) {
      await sleep(500);
      reached = modelRequests.slice(requestsBefore).some((r) => r.userText.includes(slashMarker));
    }
    expect("cron.text-not-command", ran.ok && reached,
      "a scheduled task whose text is a slash command reaches the agent as plain text",
      ran.ok ? "the task ran but its text never reached the model — the gateway may have run it as a command" : ran.error);
    const cleared = await rpc("cron.remove", { id: slash.payload.id });
    if (!cleared.ok && !/not found|unknown/i.test(cleared.error)) record("cron.slash-cleanup", "warn", cleared.error);
  } else {
    expect("cron.text-not-command", false, "", slash.ok ? "cron.add returned no id" : slash.error);
  }

  const runs = await rpc("cron.runs", { id: jobId, limit: 5, sortDir: "desc" });
  expect("cron.runs", runs.ok, "cron.runs {id, limit, sortDir}", runs.ok ? undefined : runs.error);
  const removed = await rpc("cron.remove", { id: jobId });
  expect("cron.remove", removed.ok, "cron.remove {id}", removed.ok ? undefined : removed.error);
}

async function cleanUp(original: { raw: string }): Promise<void> {
  await client.waitUntilReady();
  // agents.delete reports per-path failures instead of throwing; an agent whose
  // clean-up is incomplete cannot be re-created ("deletion cleanup is still
  // pending") until agents.delete is retried and finishes.
  const incomplete: string[] = [];
  for (const agentId of [OWNER, OTHER]) {
    const gone = await rpc<{ failed?: Array<{ path: string; reason: string }>; purgeFailed?: boolean }>(
      "agents.delete", { agentId, deleteFiles: true }, 60_000);
    if (!gone.ok) {
      if (!/not found/i.test(gone.error)) incomplete.push(`${agentId}: ${gone.error}`);
    } else if (gone.payload.purgeFailed || (gone.payload.failed ?? []).length > 0) {
      incomplete.push(`${agentId}: ${gone.payload.purgeFailed ? "session purge failed; " : ""}${(gone.payload.failed ?? []).map((f) => `${f.path} (${f.reason})`).join(", ")}`);
    }
    await client.waitUntilReady();
  }
  expect("provision.agent-delete", incomplete.length === 0, "agents.delete {agentId, deleteFiles} removes both probe agents completely", incomplete.join(" | "));
  if (!original.raw) return;
  // Put back the document as first read. The probe agents are gone from the
  // gateway's roster, and the original never had them.
  const current = await readGatewayConfig();
  const restore = { blob: JSON.parse(original.raw) as ConfigBlob, hash: current.hash, before: current.before };
  await writeGatewayConfig(restore);
  const after = await readGatewayConfig();
  const strip = (raw: string) => {
    const doc = JSON.parse(raw) as Record<string, unknown>;
    delete doc.meta;
    return JSON.stringify(doc);
  };
  expect("cleanup.config-restored", strip(after.before) === strip(original.raw), "gateway config is back to the document the probe found (ignoring meta)");
}

// ---------------------------------------------------------------------------
async function main(): Promise<number> {
  if (!flag("--yes")) {
    console.error("This probe writes gateway config (the gateway reloads and aborts runs in flight).\nRe-run with --yes on a gateway nobody is using.  See the header of this file.");
    return 2;
  }
  await new Promise<void>((resolve, reject) => standIn.once("error", reject).listen(MOCK_PORT, "127.0.0.1", resolve));
  const original = { raw: "" };
  let setUpDone = false;
  try {
    if (!(await checkConnect())) return 1;
    await checkBaseline();
    await setUp(original);
    setUpDone = true;
    await checkIsolation();
    await checkSessionIsolation();
    await checkPortalSessionFlow();
    await checkProvisioning();
  } catch (err) {
    record("probe.error", "fail", err instanceof Error ? err.stack ?? err.message : String(err));
  } finally {
    try {
      if (setUpDone || original.raw) await cleanUp(original);
      else for (const agentId of [OWNER, OTHER]) await rpc("agents.delete", { agentId, deleteFiles: true }, 60_000);
    } catch (err) {
      record("cleanup.error", "fail", errText(err));
    }
    standIn.close();
    client.close();
  }
  const failed = checks.filter((c) => c.status === "fail");
  const warned = checks.filter((c) => c.status === "warn");
  console.log(`\n${checks.filter((c) => c.status === "pass").length} passed, ${failed.length} failed, ${warned.length} warning(s)`);
  const relayed = new Set<string>(RELAYED_GATEWAY_EVENTS);
  const notRelayed = [...broadcasts.keys()].filter((name) => !relayed.has(name)).sort();
  console.log(`      events not relayed to browsers: ${notRelayed.join(", ") || "none seen"}`);
  report.broadcastEvents = Object.fromEntries(broadcasts);
  report.finishedAt = new Date().toISOString();
  report.checks = checks;
  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 1));
  return failed.length > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("FATAL:", err);
    process.exit(1);
  },
);
