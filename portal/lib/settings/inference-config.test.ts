import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyInferenceSettings, normalizeInferenceUrl, type InferenceSettings } from "./inference-config";

const on: InferenceSettings = { url: "http://inference:8000/v1", modelId: "gemma-4-31b-it", contextWindow: 262144, source: "portal" };
const off: InferenceSettings = { url: null, modelId: "gemma-4-31b-it", contextWindow: 262144, source: "none" };

describe("inference settings", () => {
  it("normalizes the URL and rejects what is not one", () => {
    assert.equal(normalizeInferenceUrl(" http://inference:8000/v1/ "), "http://inference:8000/v1");
    assert.equal(normalizeInferenceUrl(""), null);
    assert.throws(() => normalizeInferenceUrl("not a url"), /not a URL/);
    assert.throws(() => normalizeInferenceUrl("inference:8000"), /http or https/);
    assert.throws(() => normalizeInferenceUrl("ftp://x"), /http or https/);
  });

  it("writes the provider and the default model, and is idempotent", () => {
    const cfg: Record<string, unknown> = {};
    assert.deepEqual(applyInferenceSettings(cfg, on), ["models.providers.openai", "agents.defaults.model"]);
    assert.deepEqual(applyInferenceSettings(cfg, on), []);
    const c = cfg as { models: { providers: { openai: { baseUrl: string; models: { id: string; contextWindow: number }[] } } }; agents: { defaults: { model: string } } };
    assert.equal(c.models.providers.openai.baseUrl, "http://inference:8000/v1");
    assert.equal(c.models.providers.openai.models[0].contextWindow, 262144);
    assert.equal(c.agents.defaults.model, "openai/gemma-4-31b-it");
  });

  it("removes the provider and the default model when there is no endpoint", () => {
    const cfg: Record<string, unknown> = {};
    applyInferenceSettings(cfg, on);
    assert.deepEqual(applyInferenceSettings(cfg, off), ["models.providers.openai", "agents.defaults.model"]);
    const c = cfg as { models: { providers: Record<string, unknown> }; agents: { defaults: { model?: string } } };
    assert.deepEqual(c.models.providers, {});
    assert.equal(c.agents.defaults.model, undefined);
  });

  it("leaves a default model from another provider alone", () => {
    const cfg: Record<string, unknown> = { agents: { defaults: { model: "anthropic/claude-opus-4-8" } } };
    applyInferenceSettings(cfg, off);
    assert.equal((cfg as { agents: { defaults: { model: string } } }).agents.defaults.model, "anthropic/claude-opus-4-8");
  });
});

describe("inference settings against a config read from a running gateway", () => {
  it("treats the redacted apiKey as unchanged, so an identical save writes nothing", () => {
    const cfg: Record<string, unknown> = {};
    applyInferenceSettings(cfg, on);
    // What config.get hands back: the stored key replaced by the sentinel.
    (cfg as { models: { providers: { openai: { apiKey: string } } } }).models.providers.openai.apiKey = "__OPENCLAW_REDACTED__";
    assert.deepEqual(applyInferenceSettings(cfg, on), []);
    assert.equal((cfg as { models: { providers: { openai: { apiKey: string } } } }).models.providers.openai.apiKey, "__OPENCLAW_REDACTED__");
  });

  it("still writes when something other than the key differs", () => {
    const cfg: Record<string, unknown> = {};
    applyInferenceSettings(cfg, on);
    (cfg as { models: { providers: { openai: { apiKey: string } } } }).models.providers.openai.apiKey = "__OPENCLAW_REDACTED__";
    assert.deepEqual(applyInferenceSettings(cfg, { ...on, url: "http://other:8000/v1" }), ["models.providers.openai"]);
  });
});
