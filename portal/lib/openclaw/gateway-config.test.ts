import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OpenClawClient } from "./adapter";
import { readGatewayConfig, writeGatewayConfig } from "./gateway-config";

/** A stand-in for the gateway client: canned config.get, recorded writes. */
function fakeClient(configGet: unknown) {
  const calls: Array<{ method: string; params: unknown }> = [];
  let ready = 0;
  const client = {
    async call(method: string, params: unknown) {
      calls.push({ method, params });
      return method === "config.get" ? configGet : { ok: true };
    },
    async waitUntilReady() {
      ready++;
    },
  } as unknown as OpenClawClient;
  return { client, calls, readyCount: () => ready };
}

describe("gateway config read-modify-write", () => {
  it("builds the document from raw when the gateway provides it", async () => {
    const { client } = fakeClient({
      valid: true,
      raw: JSON.stringify({ agents: { entries: { main: {} } }, marker: "raw" }),
      parsed: { marker: "parsed" },
      config: { marker: "config", materializedDefault: 1 },
      hash: "h1",
    });
    const snapshot = await readGatewayConfig(client);
    assert.equal((snapshot.blob as Record<string, unknown>).marker, "raw");
    assert.equal(snapshot.hash, "h1");
  });

  it("falls back to the authored `parsed` view when raw is withheld — never to the runtime view", async () => {
    const { client } = fakeClient({
      valid: true,
      raw: null,
      parsed: { agents: { entries: { main: {} } }, marker: "parsed" },
      config: { marker: "config", agents: { defaults: { maxConcurrent: 32 } } },
      hash: "h2",
    });
    const snapshot = await readGatewayConfig(client);
    assert.equal((snapshot.blob as Record<string, unknown>).marker, "parsed");
    // The materialized default from the runtime view must not leak in.
    assert.equal(snapshot.blob.agents?.defaults, undefined);
  });

  it("normalizes a legacy agents.list while reading", async () => {
    const { client } = fakeClient({
      valid: true,
      raw: JSON.stringify({ agents: { list: [{ id: "main" }, { id: "keith", tools: { deny: ["x"] } }] } }),
      hash: "h3",
    });
    const { blob } = await readGatewayConfig(client);
    assert.deepEqual(blob.agents, {
      entries: { main: {}, keith: { tools: { deny: ["x"] } } },
      ownership: "explicit",
    });
  });

  it("refuses to build a write from an invalid or empty config", async () => {
    // What the gateway returns for an invalid config: contents withheld.
    await assert.rejects(readGatewayConfig(fakeClient({ valid: false, raw: null, config: {} }).client), /invalid/);
    await assert.rejects(readGatewayConfig(fakeClient({}).client), /neither/);
  });

  it("skips the write, and the reload it causes, when nothing changed", async () => {
    const { client, calls, readyCount } = fakeClient({ valid: true, raw: JSON.stringify({ a: 1 }), hash: "h4" });
    const snapshot = await readGatewayConfig(client);
    assert.equal(await writeGatewayConfig(snapshot, client), false);
    assert.deepEqual(calls.map((c) => c.method), ["config.get"]);
    assert.equal(readyCount(), 0);
  });

  it("writes the whole document with the hash it read, then waits for the gateway", async () => {
    const { client, calls, readyCount } = fakeClient({ valid: true, raw: JSON.stringify({ a: 1 }), hash: "h5" });
    const snapshot = await readGatewayConfig(client);
    (snapshot.blob as Record<string, unknown>).b = 2;
    assert.equal(await writeGatewayConfig(snapshot, client), true);
    assert.deepEqual(calls[1], { method: "config.set", params: { raw: JSON.stringify({ a: 1, b: 2 }), baseHash: "h5" } });
    assert.equal(readyCount(), 1);
  });
});
