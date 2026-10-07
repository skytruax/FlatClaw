/**
 * Real-model check: the same agent, the same prompts, against the real
 * inference endpoint, with OpenClaw Tool Search off and then on.
 *
 * Everything else in this repo's test suite uses a stand-in model, which can
 * show what the gateway sends and records but not how Gemma behaves. This
 * script needs the GPU lane up and the model registered on this gateway
 * (infra/scripts/prod-up.sh does both; `openai/gemma-4-31b-it` by default).
 *
 * It creates a throwaway agent (zz-realmodel) with the stub MCP server from
 * scripts/fixtures/, grown to --tools synthetic tools so the catalog is as
 * large as a connected service's, then runs a short scenario in a fresh
 * session per mode:
 *
 *   1. a plain reply
 *   2. an MCP tool the agent has to pick out of the catalog (echo_approval)
 *   3. a needle in the catalog (probe_tool_042)
 *   4. a shell command (exec is direct in both modes)
 *   5. a plain reply after the tool work
 *
 * For every turn it records time to first text, total time, the tools that
 * ran, the session's token usage, and whether the turn did what was asked.
 * Then it prints both modes side by side and writes a JSON report.
 *
 * Run from portal/, with the gateway up:
 *
 *   npx tsx scripts/real-model-check.ts --yes [--tool-search off|on|both]
 *                                        [--tools 150] [--model openai/gemma-4-31b-it]
 *                                        [--out report.json] [--dry-run]
 *
 * It writes gateway config (the throwaway agent, the stub server, the Tool
 * Search flag), restores all of it afterwards, and aborts runs in flight on
 * the gateway while it does so. Not for a tenant with people in it.
 * Exit 0 = every turn did what was asked in every mode, 1 = a turn failed,
 * 2 = the model is not registered or usage error.
 */
import path from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { getGatewayClient } from "../lib/openclaw/adapter";
import { deleteGatewayAgent, waitForAgentLoaded } from "../lib/openclaw/agent-lifecycle";
import { findAgentEntry, type ConfigBlob } from "../lib/openclaw/agent-roster";
import { applyManagedToolPolicies, managedServerName, registerManagedPrefix } from "../lib/openclaw/agent-tool-policy";
import { readGatewayConfig, writeGatewayConfig } from "../lib/openclaw/gateway-config";
import { unwrapToolCall } from "../lib/openclaw/tool-call-wrapper";

const argv = process.argv.slice(2);
const option = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const MODEL_REF = option("--model") ?? "openai/gemma-4-31b-it";
const TOOL_COUNT = Number(option("--tools") ?? 150);
const MODES = ((option("--tool-search") ?? "both") === "both" ? ["off", "on"] : [option("--tool-search")!]) as Array<"off" | "on">;
const OUT = option("--out");
const DRY_RUN = argv.includes("--dry-run");
const AGENT = "zz-realmodel";
const PREFIX = "zzreal-";
const TURN_TIMEOUT_MS = 300_000;

const client = getGatewayClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const textOf = (c: unknown): string => typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b as { text?: string })?.text ?? "").join("") : "";

interface TurnRecord {
  name: string;
  prompt: string;
  ok: boolean;
  why: string;
  firstTextMs: number | null;
  totalMs: number;
  finalState: string;
  toolsRun: string[];
  finalText: string;
  usageAfter: Record<string, unknown> | null;
}

/** One chat turn, observed through the gateway's events. */
async function runTurn(sessionKey: string, prompt: string): Promise<Omit<TurnRecord, "name" | "prompt" | "ok" | "why" | "usageAfter">> {
  const started = Date.now();
  let firstTextMs: number | null = null;
  const toolsRun: string[] = [];
  let finalState = "none";
  let finalText = "";
  const done = new Promise<void>((resolve) => {
    const timer = setTimeout(() => { off(); finalState = "timeout"; resolve(); }, TURN_TIMEOUT_MS);
    const off = client.on((event, payload) => {
      const p = (payload ?? {}) as { sessionKey?: string; state?: string; stream?: string; message?: { content?: unknown }; errorMessage?: string; data?: Record<string, unknown> };
      if (p.sessionKey !== sessionKey) return;
      if (event === "chat" && p.state === "delta" && firstTextMs === null && textOf(p.message?.content).length > 0) firstTextMs = Date.now() - started;
      if ((event === "agent" || event === "session.tool") && (p.stream === "tool" || p.stream === "exec") && p.data?.phase === "start") {
        const d = p.data as { name?: string; args?: unknown; parentToolCallId?: unknown };
        if (d.parentToolCallId === undefined) {
          const call = unwrapToolCall(String(d.name ?? ""), d.args);
          toolsRun.push(call.name);
        }
      }
      if (event === "chat" && typeof p.state === "string" && ["final", "error", "aborted"].includes(p.state)) {
        clearTimeout(timer); off();
        finalState = p.state;
        finalText = textOf(p.message?.content) || p.errorMessage || "";
        resolve();
      }
    });
  });
  await client.call("chat.send", { sessionKey, message: prompt, idempotencyKey: randomUUID() }, 60_000);
  await done;
  return { firstTextMs, totalMs: Date.now() - started, finalState, toolsRun, finalText };
}

async function usageOf(sessionKey: string): Promise<Record<string, unknown> | null> {
  try {
    const r = (await client.call("sessions.usage", { key: sessionKey, includeContextWeight: true })) as { sessions?: Array<{ usage?: Record<string, unknown>; contextWeight?: Record<string, unknown> }> };
    const s = r.sessions?.[0];
    return s ? { ...(s.usage ?? {}), contextWeight: s.contextWeight ?? null } : null;
  } catch (err) {
    return { error: errText(err) };
  }
}

function scenario(ownServer: string) {
  const echo = `${ownServer}__echo_approval`;
  const needle = `${ownServer}__probe_tool_042`;
  return [
    { name: "plain", prompt: "Reply with the single word READY and nothing else.", check: (t: TurnRecord) => (/READY/i.test(t.finalText) ? "" : "did not answer READY") },
    { name: "mcp-tool", prompt: `Use the tool named echo_approval (part of the ${ownServer} service) with the note "realmodel". Then tell me, in one line, the value of the status field it returned.`,
      check: (t: TurnRecord) => (!t.toolsRun.includes(echo) ? `echo_approval was not called (tools run: ${t.toolsRun.join(", ") || "none"})` : /PENDING_HUMAN_APPROVAL/.test(t.finalText) ? "" : "the status was not reported") },
    { name: "catalog-needle", prompt: `One of your tools answers questions in the "alpha domain". Call it with the query "alpha" and report the answer it returned, verbatim, in one line.`,
      check: (t: TurnRecord) => (!t.toolsRun.includes(needle) ? `probe_tool_042 was not called (tools run: ${t.toolsRun.join(", ") || "none"})` : /probe_tool_042-answer-for-alpha/.test(t.finalText) ? "" : "the answer was not reported") },
    { name: "exec", prompt: "Run the shell command `echo real-model-ok` and show me its exact output.",
      check: (t: TurnRecord) => (!t.toolsRun.includes("exec") ? `exec was not called (tools run: ${t.toolsRun.join(", ") || "none"})` : /real-model-ok/.test(t.finalText) ? "" : "the output was not shown") },
    { name: "plain-after-tools", prompt: "In one short sentence: what is the capital of France?", check: (t: TurnRecord) => (/paris/i.test(t.finalText) ? "" : "did not answer Paris") },
  ];
}

async function main(): Promise<number> {
  if (!argv.includes("--yes")) {
    console.error("This writes gateway config and aborts runs in flight. Re-run with --yes on a gateway nobody is using. See the header of this file.");
    return 2;
  }
  await client.connect();
  const listed = (await client.call("models.list", {})) as { models?: Array<{ provider?: string; id?: string }> };
  if (!(listed.models ?? []).some((m) => `${m.provider}/${m.id}` === MODEL_REF)) {
    console.error(`${MODEL_REF} is not registered on this gateway. Bring the lane up first (infra/scripts/prod-up.sh), or pass --model <provider/id>. Registered: ${(listed.models ?? []).map((m) => `${m.provider}/${m.id}`).join(", ") || "none"}`);
    client.close();
    return 2;
  }
  const fixture = path.resolve(process.cwd(), "scripts/fixtures/contract-probe-mcp.mjs");
  if (!existsSync(fixture)) { console.error("run this from portal/"); client.close(); return 2; }

  const original = (await readGatewayConfig()).before;
  const report: Record<string, unknown> = { model: MODEL_REF, toolCount: TOOL_COUNT, startedAt: new Date().toISOString(), modes: {} as Record<string, TurnRecord[]> };
  let failed = 0;
  try {
    await deleteGatewayAgent(AGENT);
    await client.call("agents.create", { name: AGENT, workspace: `${homedir()}/.openclaw/workspace-${AGENT}` }, 60_000);
    await client.waitUntilReady();
    await waitForAgentLoaded(AGENT);
    const ownServer = managedServerName(PREFIX, AGENT);
    const snapshot = await readGatewayConfig();
    const blob = snapshot.blob as ConfigBlob & { tools?: Record<string, unknown> };
    for (const name of Object.keys(blob.mcp?.servers ?? {})) { const dash = name.indexOf("-"); if (dash > 0) registerManagedPrefix(name.slice(0, dash + 1)); }
    registerManagedPrefix(PREFIX);
    blob.mcp = blob.mcp ?? {}; blob.mcp.servers = blob.mcp.servers ?? {};
    blob.mcp.servers[ownServer] = { command: "node", args: [fixture], env: { PROBE_OWNER: AGENT, PROBE_TOOL_COUNT: String(TOOL_COUNT) } };
    const entry = findAgentEntry(blob, AGENT);
    if (!entry) throw new Error(`${AGENT} missing from the roster after agents.create`);
    entry.model = MODEL_REF;
    applyManagedToolPolicies(blob);
    await writeGatewayConfig(snapshot);
    console.log(`agent ${AGENT} with ${TOOL_COUNT + 1} MCP tools on ${ownServer}, model ${MODEL_REF}`);
    if (DRY_RUN) { console.log("dry run: setup worked; skipping turns"); return 0; }

    for (const mode of MODES) {
      const snap = await readGatewayConfig();
      ((snap.blob as ConfigBlob & { tools?: Record<string, unknown> }).tools ??= {}).toolSearch = mode === "on";
      await writeGatewayConfig(snap);
      await client.waitUntilReady();
      await sleep(3_000);
      const created = (await client.call("sessions.create", { agentId: AGENT, model: MODEL_REF, label: `real-model ${mode}` })) as { key?: string; sessionKey?: string };
      const sessionKey = (created.key ?? created.sessionKey)!;
      console.log(`\n=== Tool Search ${mode.toUpperCase()} (session ${sessionKey})`);
      const rows: TurnRecord[] = [];
      for (const step of scenario(ownServer)) {
        const turn = await runTurn(sessionKey, step.prompt);
        const record: TurnRecord = { name: step.name, prompt: step.prompt, ok: false, why: "", usageAfter: await usageOf(sessionKey), ...turn };
        record.why = turn.finalState !== "final" ? `run ended ${turn.finalState}: ${turn.finalText.slice(0, 160)}` : step.check(record);
        record.ok = record.why === "";
        if (!record.ok) failed++;
        rows.push(record);
        console.log(`${record.ok ? "PASS" : "FAIL"}  ${step.name.padEnd(18)} first text ${record.firstTextMs ?? "-"} ms, total ${record.totalMs} ms, tools [${record.toolsRun.join(", ")}]${record.ok ? "" : ` — ${record.why}`}`);
        console.log(`      reply: ${JSON.stringify(record.finalText.slice(0, 160))}`);
      }
      (report.modes as Record<string, TurnRecord[]>)[mode] = rows;
      await client.call("sessions.delete", { key: sessionKey }).catch(() => undefined);
    }
    if (MODES.length === 2) {
      const [off, on] = [(report.modes as Record<string, TurnRecord[]>).off, (report.modes as Record<string, TurnRecord[]>).on];
      console.log("\n=== Side by side (off → on)");
      for (let i = 0; i < off.length; i++) {
        console.log(`${off[i].name.padEnd(18)} first text ${off[i].firstTextMs ?? "-"} → ${on[i].firstTextMs ?? "-"} ms, total ${off[i].totalMs} → ${on[i].totalMs} ms, ${off[i].ok ? "ok" : "FAIL"} → ${on[i].ok ? "ok" : "FAIL"}`);
      }
      const tokens = (r: TurnRecord) => JSON.stringify(r.usageAfter ?? {}).slice(0, 200);
      console.log(`usage after the first turn, off: ${tokens(off[0])}`);
      console.log(`usage after the first turn, on:  ${tokens(on[0])}`);
    }
  } catch (err) {
    console.error("FATAL:", err instanceof Error ? err.stack ?? err.message : err);
    failed++;
  } finally {
    try {
      await deleteGatewayAgent(AGENT);
      const current = await readGatewayConfig();
      await writeGatewayConfig({ blob: JSON.parse(original) as ConfigBlob, hash: current.hash, before: current.before });
      console.log("\nclean-up: throwaway agent removed, config restored (Tool Search back to what it was)");
    } catch (err) {
      console.error("clean-up failed:", errText(err));
      failed++;
    }
    report.finishedAt = new Date().toISOString();
    if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 1));
    client.close();
  }
  return failed === 0 ? 0 : 1;
}

main().then((code) => process.exit(code), (err) => { console.error("FATAL:", err); process.exit(1); });
