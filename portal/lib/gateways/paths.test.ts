import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allocateGatewayPort, assertAgentId, gatewayUnixUserName, workspacePathFor } from "./paths";
import { buildUserGatewayConfig } from "./config-template";

describe("gateway paths", () => {
  it("rejects agent ids that could escape a directory", () => {
    for (const bad of ["../x", "a/b", "", "A", "x y", ".hidden"]) assert.throws(() => assertAgentId(bad), bad);
    assert.equal(assertAgentId("nate-kirktechsolutions-com"), "nate-kirktechsolutions-com");
  });

  it("hands out the smallest free port at or above the base", () => {
    const base = allocateGatewayPort([]);
    assert.equal(allocateGatewayPort([base]), base + 1);
    assert.equal(allocateGatewayPort([base, base + 2]), base + 1);
  });

  it("keeps Unix account names within 32 characters and distinct per agent", () => {
    const a = gatewayUnixUserName("hemanshu-patel-kirktechsolutions", "07daf68d");
    const b = gatewayUnixUserName("hemanshu-patel-kirktechsolution2", "a1b2c3d4");
    assert.ok(a.length <= 32 && b.length <= 32, `${a} ${b}`);
    assert.notEqual(a, b);
    assert.match(a, /^fcg-[a-z0-9-]+-[0-9a-f]{6}$/);
  });

  it("puts the workspace under the shared state in shared mode", () => {
    const prev = process.env.FLATCLAW_GATEWAY_MODE;
    delete process.env.FLATCLAW_GATEWAY_MODE;
    assert.match(workspacePathFor("ana-rehearsal-test"), /\.openclaw\/workspace-ana-rehearsal-test$/);
    process.env.FLATCLAW_GATEWAY_MODE = "per-user";
    assert.match(workspacePathFor("ana-rehearsal-test"), /gateways\/ana-rehearsal-test\/workspace-ana-rehearsal-test$/);
    if (prev === undefined) delete process.env.FLATCLAW_GATEWAY_MODE; else process.env.FLATCLAW_GATEWAY_MODE = prev;
  });
});

describe("per-user gateway template", () => {
  it("is a loopback token gateway with the baseline applied and the heartbeat off", () => {
    const cfg = buildUserGatewayConfig({ port: 18801, token: "t", inference: { url: "http://inference:8000/v1", modelId: "gemma-4-31b-it", contextWindow: 262144, source: "env" } }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(cfg.gateway.bind, "loopback");
    assert.equal(cfg.gateway.port, 18801);
    assert.equal(cfg.gateway.auth.token, "t");
    assert.equal(cfg.agents.defaults.model, "openai/gemma-4-31b-it");
    assert.equal(cfg.agents.defaults.heartbeat.every, "0m");
    assert.equal(cfg.tools.sessions.visibility, "tree");
    assert.equal(cfg.commands.restart, false);
    assert.equal(cfg.memory.search.provider, "none");
    assert.deepEqual(cfg.plugins.allow, ["document-extract", "duckduckgo", "memory-core", "web-readability"]);
  });

  it("works without an inference endpoint", () => {
    const cfg = buildUserGatewayConfig({ port: 18802, token: "t" }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(cfg.models.providers, {});
    assert.equal(cfg.agents.defaults.model, undefined);
  });
});
