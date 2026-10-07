#!/usr/bin/env node
// Minimal stdio MCP server used only by scripts/gateway-contract-probe.ts.
//
// It exposes one tool, `echo_approval`, which returns the same JSON envelope a
// FlatClaw approval-gated MCP tool returns ({status: "PENDING_HUMAN_APPROVAL",
// approval: {...}, composedRequest: {...}}). The probe has a stand-in model call
// it through the gateway and then checks that the portal can still read that
// envelope back out of the transcript — the contract lib/openclaw/approvals.ts
// depends on. No dependencies: MCP's stdio transport is newline-delimited
// JSON-RPC 2.0, which is all this implements.
import { createInterface } from "node:readline";

const TOOL = {
  name: "echo_approval",
  description:
    "Contract probe. Returns a FlatClaw approval envelope echoing `note`. Performs no action.",
  inputSchema: {
    type: "object",
    properties: { note: { type: "string", description: "Text to echo back." } },
    required: ["note"],
  },
};

// A synthetic catalog for the real-model check (scripts/real-model-check.ts):
// PROBE_TOOL_COUNT extra tools, each with a distinct one-line description, so a
// model has to find the one it needs among many. Each answers with a marker.
const TOPICS = ["invoices", "shipments", "inventory", "payroll", "tickets", "contracts", "leases", "orders", "returns", "quotes", "budgets", "audits", "schedules", "vendors", "assets"];
const VERBS = ["list", "summarize", "reconcile", "forecast", "archive", "validate", "compare", "export", "flag", "allocate"];
const EXTRA_COUNT = Math.max(0, Math.min(500, Number(process.env.PROBE_TOOL_COUNT ?? 0) || 0));
const extraTool = (i) => {
  const id = String(i).padStart(3, "0");
  const topic = TOPICS[i % TOPICS.length];
  const verb = VERBS[Math.floor(i / TOPICS.length) % VERBS.length];
  return {
    name: `probe_tool_${id}`,
    description: i === 42
      ? "Answer a question in the alpha domain. Returns the alpha answer for a query."
      : `${verb[0].toUpperCase()}${verb.slice(1)} ${topic} for a given account (synthetic probe tool ${id}; returns a marker).`,
    inputSchema: { type: "object", properties: { query: { type: "string", description: "What to look up." } }, required: ["query"] },
  };
};
const EXTRA_TOOLS = Array.from({ length: EXTRA_COUNT }, (_, i) => extraTool(i + 1));

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    process.stderr.write(`contract-probe-mcp: unparseable frame: ${err}\n`);
    return;
  }
  // Notifications carry no id and get no response.
  if (msg.id === undefined || msg.id === null) return;
  switch (msg.method) {
    case "initialize":
      return reply(msg.id, {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "flatclaw-contract-probe", version: "1.0.0" },
      });
    case "ping":
      return reply(msg.id, {});
    case "tools/list":
      return reply(msg.id, { tools: [TOOL, ...EXTRA_TOOLS] });
    case "tools/call": {
      const extra = EXTRA_TOOLS.find((t) => t.name === msg.params?.name);
      if (extra) {
        const query = String(msg.params?.arguments?.query ?? "");
        return reply(msg.id, { content: [{ type: "text", text: JSON.stringify({ ok: true, tool: extra.name, answer: `${extra.name}-answer-for-${query}` }) }] });
      }
      if (msg.params?.name !== TOOL.name) {
        return fail(msg.id, -32602, `unknown tool: ${msg.params?.name}`);
      }
      const envelope = {
        action: "contract_probe.echo",
        status: "PENDING_HUMAN_APPROVAL",
        executed: false,
        approval: {
          kind: "contract-probe",
          service: "contract-probe",
          title: "Contract probe approval",
          requestedByAgentId: process.env.OPENCLAW_AGENT_ID ?? null,
          approverPolicy: { mode: "self" },
        },
        composedRequest: { note: String(msg.params?.arguments?.note ?? "") },
        notice: "This is a contract probe. Nothing was executed.",
      };
      return reply(msg.id, {
        content: [{ type: "text", text: JSON.stringify(envelope) }],
        isError: false,
      });
    }
    default:
      return fail(msg.id, -32601, `method not found: ${msg.method}`);
  }
});
