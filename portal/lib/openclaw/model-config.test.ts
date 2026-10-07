import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ConfigBlob } from "./agent-roster";
import { agentContextTokens, modelContextTokens } from "./model-config";

const cfg = {
  models: {
    providers: {
      openai: { models: [{ id: "gemma-4-31b-it", contextWindow: 262144 }] },
      "openai-dev": { models: [{ id: "gemma-4-e4b-it", contextWindow: 131072, contextTokens: 100000 }] },
    },
  },
  agents: {
    defaults: { model: "openai/gemma-4-31b-it" },
    entries: { main: {}, dev: { model: { primary: "openai-dev/gemma-4-e4b-it" } }, odd: { model: "nowhere/unknown" } },
  },
} as unknown as ConfigBlob;

describe("model context window", () => {
  it("reads the window from the provider's model entry", () => {
    assert.equal(modelContextTokens(cfg, "openai/gemma-4-31b-it"), 262144);
  });
  it("prefers an explicit contextTokens budget over the native window", () => {
    assert.equal(modelContextTokens(cfg, "openai-dev/gemma-4-e4b-it"), 100000);
  });
  it("answers null for a model the config does not describe", () => {
    assert.equal(modelContextTokens(cfg, "openai/other"), null);
    assert.equal(modelContextTokens(cfg, "no-slash"), null);
    assert.equal(modelContextTokens(cfg, null), null);
  });
  it("uses the agent's own model when its roster entry pins one, else the tenant default", () => {
    assert.equal(agentContextTokens(cfg, "main"), 262144);
    assert.equal(agentContextTokens(cfg, "dev"), 100000);
    assert.equal(agentContextTokens(cfg, "someone-new"), 262144);
    // An agent pinned to a model we cannot size falls back to the tenant default.
    assert.equal(agentContextTokens(cfg, "odd"), 262144);
  });
});
