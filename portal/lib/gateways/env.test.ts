import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gatewayChildEnv, type EnvMap } from "./env";

describe("gateway child environment", () => {
  const parent: EnvMap = {
    PATH: "/usr/bin",
    HOME: "/data",
    PORTAL_SECRETS_KEY: "k",
    AUTH_SECRET: "s",
    PORTAL_SEED_USERS: "[]",
    NORTHFLANK_API_TOKEN: "t",
    FLATCLAW_CPANEL_API_TOKEN: "t",
    VENDOR_REFRESH_TOKEN: "t",
    VENDOR_CLIENT_SECRET: "t",
    OPEN_AI_API_KEY: "t",
    FLATCLAW_JIRA_MCP_ENTRY: "/app/mcp/public/jira/build/index.js",
    FLATCLAW_SOME_MCP_DB: "/data/some-mcp/data.sqlite",
    PROD_INFERENCE_URL: "http://inference:8000/v1",
    OPENCLAW_STATE_DIR: "/data/.openclaw",
  };

  it("drops the portal's own secrets and anything credential-shaped", () => {
    const env = gatewayChildEnv(parent, { stateDir: "/data/.openclaw-portal/gateways/ana" });
    for (const k of ["PORTAL_SECRETS_KEY", "AUTH_SECRET", "PORTAL_SEED_USERS", "NORTHFLANK_API_TOKEN", "FLATCLAW_CPANEL_API_TOKEN", "VENDOR_REFRESH_TOKEN", "VENDOR_CLIENT_SECRET", "OPEN_AI_API_KEY"]) {
      assert.equal(env[k], undefined, `${k} must not reach a gateway`);
    }
  });

  it("keeps what the gateway and its MCP servers need, and points state at the gateway's directory", () => {
    const env = gatewayChildEnv(parent, { stateDir: "/data/.openclaw-portal/gateways/ana" });
    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.FLATCLAW_JIRA_MCP_ENTRY, parent.FLATCLAW_JIRA_MCP_ENTRY);
    assert.equal(env.FLATCLAW_SOME_MCP_DB, parent.FLATCLAW_SOME_MCP_DB);
    assert.equal(env.PROD_INFERENCE_URL, parent.PROD_INFERENCE_URL);
    assert.equal(env.HOME, "/data/.openclaw-portal/gateways/ana/home");
    assert.equal(env.OPENCLAW_STATE_DIR, "/data/.openclaw-portal/gateways/ana");
    assert.equal(env.OPENCLAW_CONFIG_PATH, "/data/.openclaw-portal/gateways/ana/openclaw.json");
  });

  it("lets an operator pass a named secret through on purpose", () => {
    const env = gatewayChildEnv({ ...parent, FLATCLAW_GATEWAY_ENV_ALLOW: "OPEN_AI_API_KEY" }, { stateDir: "/x" });
    assert.equal(env.OPEN_AI_API_KEY, "t");
    assert.equal(env.PORTAL_SECRETS_KEY, undefined);
  });
});
