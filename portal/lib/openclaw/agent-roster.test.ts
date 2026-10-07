import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  agentEntries,
  ensureAgentEntry,
  findAgentEntry,
  listAgentIds,
  normalizeAgentRoster,
  type ConfigBlob,
} from "./agent-roster";

describe("agent roster", () => {
  it("reads the keyed roster (openclaw ≥ 2026.8) without changing it", () => {
    const cfg: ConfigBlob = {
      agents: { ownership: "explicit", entries: { main: {}, keith: { tools: { deny: ["x"] } } } },
    };
    const before = JSON.stringify(cfg);
    assert.deepEqual(listAgentIds(cfg), ["main", "keith"]);
    assert.deepEqual(findAgentEntry(cfg, "keith")?.tools?.deny, ["x"]);
    assert.equal(findAgentEntry(cfg, "nobody"), undefined);
    assert.equal(JSON.stringify(cfg), before);
  });

  it("converts a pre-2026.8 agents.list the way the gateway's migration does", () => {
    const cfg = {
      agents: {
        defaults: { model: "openai/gemma-4-31b-it" },
        list: [{ id: "main", tools: { deny: ["a__*"] } }, { id: "keith", skills: ["github"] }],
      },
    } as unknown as ConfigBlob;
    normalizeAgentRoster(cfg);
    assert.equal("list" in (cfg.agents ?? {}), false);
    assert.deepEqual(cfg.agents?.entries, {
      main: { tools: { deny: ["a__*"] } },
      keith: { skills: ["github"] },
    });
    // A multi-agent roster fails gateway validation without this marker.
    assert.equal(cfg.agents?.ownership, "explicit");
    assert.deepEqual(cfg.agents?.defaults, { model: "openai/gemma-4-31b-it" });
  });

  it("does not mark a single-agent roster as explicitly owned", () => {
    const cfg = { agents: { list: [{ id: "main" }] } } as unknown as ConfigBlob;
    normalizeAgentRoster(cfg);
    assert.equal(cfg.agents?.ownership, undefined);
  });

  it("creates the roster map on demand", () => {
    const cfg: ConfigBlob = {};
    assert.deepEqual(agentEntries(cfg), {});
    assert.deepEqual(cfg.agents?.entries, {});
  });

  it("ensureAgentEntry returns the existing entry, or adds one and marks ownership", () => {
    const cfg: ConfigBlob = { agents: { entries: { main: { tools: { deny: ["x"] } } } } };
    assert.equal(ensureAgentEntry(cfg, "main"), cfg.agents!.entries!.main);
    assert.equal(cfg.agents?.ownership, undefined);
    const added = ensureAgentEntry(cfg, "keith");
    assert.deepEqual(added, {});
    assert.equal(cfg.agents?.ownership, "explicit");
  });
});
