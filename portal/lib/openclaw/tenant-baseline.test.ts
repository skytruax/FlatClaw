import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ConfigBlob } from "./agent-roster";
import {
  AGENTS_MD_MAX_CHARS,
  DENIED_BUILTIN_TOOLS,
  EXPECTED_BUILTIN_TOOLS,
  OPTIONAL_BUILTIN_TOOLS,
  TENANT_PLUGINS,
  builtinToolDecision,
  applyTenantBaseline,
  tenantBaselineDrift,
} from "./tenant-baseline";

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("tenant baseline", () => {
  it("pins the isolation settings on an empty config", () => {
    const cfg: Doc = {};
    applyTenantBaseline(cfg as ConfigBlob);
    assert.equal(cfg.tools.toolSearch, false);
    assert.equal(cfg.tools.swarm, false);
    assert.equal(cfg.tools.sessions.visibility, "tree");
    assert.equal(cfg.tools.agentToAgent.enabled, false);
    assert.deepEqual(cfg.tools.deny, [...DENIED_BUILTIN_TOOLS]);
    assert.equal(cfg.skills.workshop.autonomous.mode, "off");
    assert.equal(cfg.skills.workshop.approvalPolicy, "pending");
    assert.equal(cfg.plugins.entries["memory-core"].config.dreaming.enabled, false);
    assert.equal(cfg.agents.defaults.maxConcurrent, 4);
    assert.equal(cfg.agents.defaults.subagents.maxSpawnDepth, 1);
    assert.equal(cfg.agents.defaults.bootstrapMaxChars, AGENTS_MD_MAX_CHARS);
    assert.equal(cfg.agents.defaults.utilityModel, "");
    assert.equal(cfg.mcp.sessionIdleTtlMs, 600_000);
    assert.equal(cfg.memory.search.provider, "none");
    assert.deepEqual(cfg.plugins.allow, [...TENANT_PLUGINS]);
    assert.deepEqual(cfg.commands, {
      restart: false, bash: false, config: false, mcp: false, plugins: false, debug: false,
    });
    assert.equal(cfg.tools.elevated.enabled, false);
    assert.equal(cfg.gateway.terminal.enabled, false);
    assert.equal(cfg.browser.enabled, false);
    assert.equal(cfg.plugins.entries.browser.enabled, false);
    assert.equal(cfg.update.checkOnStart, false);
    assert.equal(cfg.update.auto.enabled, false);
    assert.equal(cfg.models.catalogRefresh.enabled, false);
  });

  it("is idempotent and reports no drift once applied", () => {
    const cfg: Doc = { tools: { profile: "coding" } };
    assert.ok(tenantBaselineDrift(cfg as ConfigBlob).length > 0);
    applyTenantBaseline(cfg as ConfigBlob);
    const once = JSON.stringify(cfg);
    applyTenantBaseline(cfg as ConfigBlob);
    assert.equal(JSON.stringify(cfg), once);
    assert.deepEqual(tenantBaselineDrift(cfg as ConfigBlob), []);
  });

  it("re-enforces an isolation setting someone loosened", () => {
    const cfg: Doc = {};
    applyTenantBaseline(cfg as ConfigBlob);
    cfg.tools.sessions.visibility = "all";
    cfg.tools.agentToAgent.enabled = true;
    cfg.tools.toolSearch = true; // a tenant choice, not drift
    cfg.commands.restart = true;
    cfg.gateway.terminal.enabled = true;
    assert.deepEqual(tenantBaselineDrift(cfg as ConfigBlob), [
      "commands.restart",
      "gateway.terminal.enabled",
      "tools.agentToAgent.enabled",
      "tools.sessions.visibility",
    ]);
    applyTenantBaseline(cfg as ConfigBlob);
    assert.equal(cfg.tools.toolSearch, true);
    assert.equal(cfg.tools.sessions.visibility, "tree");
    assert.equal(cfg.tools.agentToAgent.enabled, false);
  });

  it("keeps an operator's own global denies and capacity choices", () => {
    const cfg: Doc = {
      tools: { deny: ["exec", "gateway"], profile: "coding", web: { search: { provider: "duckduckgo" } } },
      agents: { defaults: { maxConcurrent: 12, utilityModel: "openai/small", model: "openai/gemma-4-31b-it" } },
      mcp: { sessionIdleTtlMs: 0, servers: { "cpanel-a": { command: "node" } } },
      memory: { search: { provider: "bge-m3-local", model: "bge-m3" } },
      models: { providers: { openai: { baseUrl: "http://inference:8000/v1" } } },
      commands: { text: true, ownerAllowFrom: ["ops"] },
    };
    applyTenantBaseline(cfg as ConfigBlob);
    assert.ok(cfg.tools.deny.includes("exec"));
    assert.equal(cfg.tools.deny.filter((d: string) => d === "gateway").length, 1);
    for (const tool of DENIED_BUILTIN_TOOLS) assert.ok(cfg.tools.deny.includes(tool));
    assert.equal(cfg.tools.profile, "coding");
    assert.equal(cfg.tools.web.search.provider, "duckduckgo");
    assert.equal(cfg.agents.defaults.maxConcurrent, 12);
    assert.equal(cfg.agents.defaults.utilityModel, "openai/small");
    assert.equal(cfg.agents.defaults.model, "openai/gemma-4-31b-it");
    assert.equal(cfg.mcp.sessionIdleTtlMs, 0);
    assert.deepEqual(cfg.mcp.servers, { "cpanel-a": { command: "node" } });
    assert.deepEqual(cfg.memory.search, { provider: "bge-m3-local", model: "bge-m3" });
    assert.deepEqual(cfg.models.providers, { openai: { baseUrl: "http://inference:8000/v1" } });
    assert.equal(cfg.commands.text, true);
    assert.deepEqual(cfg.commands.ownerAllowFrom, ["ops"]);
  });

  it("builds the plugin allowlist from what the operator already enabled, once", () => {
    const cfg: Doc = {
      plugins: { entries: { anthropic: { enabled: true }, openai: { enabled: false }, duckduckgo: { enabled: true }, "memory-core": { config: {} } } },
    };
    applyTenantBaseline(cfg as ConfigBlob);
    assert.deepEqual(cfg.plugins.allow, ["anthropic", "document-extract", "duckduckgo", "memory-core", "web-readability"]);
    // An operator's own list is never rewritten, even an empty-looking one.
    const own: Doc = { plugins: { allow: ["memory-core", "onnx"], entries: { anthropic: { enabled: true } } } };
    applyTenantBaseline(own as ConfigBlob);
    assert.deepEqual(own.plugins.allow, ["memory-core", "onnx"]);
  });

  it("puts every decided tool in exactly one list", () => {
    const all = [...EXPECTED_BUILTIN_TOOLS, ...OPTIONAL_BUILTIN_TOOLS, ...DENIED_BUILTIN_TOOLS];
    const twice = all.filter((t, i) => all.indexOf(t) !== i);
    assert.deepEqual(twice, []);
  });

  it("reports where a tool stands, and that an unknown one is undecided", () => {
    assert.equal(builtinToolDecision("exec"), "expected");
    assert.equal(builtinToolDecision("view_image"), "optional");
    assert.equal(builtinToolDecision("gateway"), "denied");
    assert.equal(builtinToolDecision("browser"), "denied");
    assert.equal(builtinToolDecision("a_tool_a_future_openclaw_adds"), "undecided");
  });
});
