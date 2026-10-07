import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GATEWAY_SERVER_NAME_MAX,
  GATEWAY_TOOL_NAME_MAX,
  applyManagedToolPolicies,
  denyPatternForServer,
  gatewayToolName,
  legacyManagedServerName,
  legacyManagedServerNames,
  managedServerName,
  registerManagedPrefix,
  safeAgentId,
  type ConfigBlob,
} from "./agent-tool-policy";

// Managed prefixes are registered at runtime by each service plugin via
// `registerManagedPrefix` (called from registerManagedMcpService). The tests
// don't load the plugin registry, so register the prefixes they exercise.
for (const p of ["cpanel-", "caldav-", "google-", "jira-"]) {
  registerManagedPrefix(p);
}

/**
 * Run with `npm test` from portal/ (all unit tests), or just this file:
 *   npx tsx --test lib/openclaw/agent-tool-policy.test.ts
 *
 * These prove FlatClaw COMPUTES the right config. Whether the gateway then
 * honours it is checked live by scripts/gateway-contract-probe.ts.
 */

function blob(
  agents: Array<{ id: string; tools?: { deny?: string[] } }>,
  serverNames: string[],
): ConfigBlob {
  const servers: Record<string, { command?: string }> = {};
  for (const n of serverNames) servers[n] = { command: "node" };
  // openclaw ≥ 2026.8 roster shape: keyed by agent id, entries carry no `id`.
  const entries: Record<string, { tools?: { deny?: string[] } }> = {};
  for (const { id, ...entry } of agents) entries[id] = entry;
  return {
    agents: { ownership: "explicit", entries },
    mcp: { servers },
  };
}

/** The deny list currently on one agent's roster entry. */
function denyOf(cfg: ConfigBlob, id: string): string[] {
  return cfg.agents!.entries![id].tools?.deny ?? [];
}

describe("safeAgentId", () => {
  it("lowercases and replaces non-alnum with hyphens", () => {
    assert.equal(safeAgentId("Skyler.FlatClaw_org"), "skyler-flatclaw-org");
  });
  it("collapses runs of hyphens and trims edges", () => {
    assert.equal(safeAgentId("--A__B--"), "a-b");
  });
});

describe("managedServerName / denyPatternForServer", () => {
  it("composes the canonical names", () => {
    assert.equal(
      managedServerName("cpanel-", "skyler-flatclaw-org"),
      "cpanel-skyler-flatclaw-org",
    );
    assert.equal(
      denyPatternForServer("cpanel-skyler-flatclaw-org"),
      "cpanel-skyler-flatclaw-org__*",
    );
  });
});

describe("applyManagedToolPolicies", () => {
  it("denies every other user's managed servers; keeps own visible", () => {
    const cfg = blob(
      [
        { id: "skyler-flatclaw-org" },
        { id: "keith-flatclaw-org" },
        { id: "nate-flatclaw-org" },
      ],
      ["cpanel-skyler-flatclaw-org", "caldav-keith-flatclaw-org"],
    );
    const r = applyManagedToolPolicies(cfg);
    assert.deepEqual(r.changedAgents.sort(), [
      "keith-flatclaw-org",
      "nate-flatclaw-org",
      "skyler-flatclaw-org",
    ]);
    const get = (id: string) => denyOf(cfg, id);
    // skyler keeps his own cpanel; denies keith caldav.
    assert.deepEqual(get("skyler-flatclaw-org"), [
      "caldav-keith-flatclaw-org__*",
    ]);
    // keith keeps his own caldav; denies skyler's cpanel.
    assert.deepEqual(get("keith-flatclaw-org"), [
      "cpanel-skyler-flatclaw-org__*",
    ]);
    // nate has no managed server at all — denies both (sorted alphabetically).
    assert.deepEqual(get("nate-flatclaw-org"), [
      "cpanel-skyler-flatclaw-org__*",
      "caldav-keith-flatclaw-org__*",
    ].sort());
  });

  it("preserves operator-authored deny patterns alongside managed ones", () => {
    const cfg = blob(
      [
        {
          id: "skyler-flatclaw-org",
          tools: { deny: ["custom-dangerous-tool", "exec"] },
        },
      ],
      ["cpanel-keith-flatclaw-org"],
    );
    applyManagedToolPolicies(cfg);
    const deny = denyOf(cfg, "skyler-flatclaw-org");
    assert.ok(deny.includes("custom-dangerous-tool"));
    assert.ok(deny.includes("exec"));
    assert.ok(deny.includes("cpanel-keith-flatclaw-org__*"));
  });

  it("strips stale managed patterns when their server is removed", () => {
    const cfg = blob(
      [
        {
          id: "skyler-flatclaw-org",
          tools: {
            // Stale pattern referencing a server no longer in mcp.servers.
            deny: [
              "cpanel-deleted-user__*",
              "operator-deny",
            ],
          },
        },
      ],
      [],
    );
    applyManagedToolPolicies(cfg);
    assert.deepEqual(denyOf(cfg, "skyler-flatclaw-org"), ["operator-deny"]);
  });

  it("is idempotent — second call produces no further changes", () => {
    const cfg = blob(
      [{ id: "a" }, { id: "b" }],
      ["cpanel-a", "caldav-b"],
    );
    const first = applyManagedToolPolicies(cfg);
    assert.equal(first.changedAgents.length, 2);
    const second = applyManagedToolPolicies(cfg);
    assert.equal(second.changedAgents.length, 0);
  });

  it("removes empty tools.deny / tools entirely", () => {
    const cfg = blob(
      [
        {
          id: "lonely",
          tools: { deny: ["cpanel-deleted__*"] },
        },
      ],
      [],
    );
    applyManagedToolPolicies(cfg);
    const entry = cfg.agents!.entries!.lonely;
    assert.equal(entry.tools, undefined);
  });

  it("ignores third-party MCP servers (non-managed names)", () => {
    const cfg = blob(
      [{ id: "skyler-flatclaw-org" }, { id: "keith-flatclaw-org" }],
      ["thirdparty-tool", "context7", "cpanel-skyler-flatclaw-org"],
    );
    applyManagedToolPolicies(cfg);
    // Only the managed server appears in deny.
    assert.deepEqual(denyOf(cfg, "keith-flatclaw-org"), [
      "cpanel-skyler-flatclaw-org__*",
    ]);
  });

  it("respects sharedServerNames opt — keeps shared servers visible to all", () => {
    const cfg = blob(
      [{ id: "a" }, { id: "b" }],
      ["caldav-a", "cpanel-shared-ftp"],
    );
    applyManagedToolPolicies(cfg, {
      sharedServerNames: new Set(["cpanel-shared-ftp"]),
    });
    const get = (id: string) => denyOf(cfg, id);
    // cpanel-shared-ftp is NOT denied for anyone.
    for (const id of ["a", "b"]) {
      assert.ok(!get(id).includes("cpanel-shared-ftp__*"));
    }
    // caldav-a is still per-user.
    assert.deepEqual(get("b"), ["caldav-a__*"]);
  });
});

// OpenClaw keeps only the first 30 characters of a server name when it names
// that server's tools. A managed name longer than that used to be exposed to
// every agent, because the deny glob built from the full name never matched.
describe("server names within the gateway's 30-character limit", () => {
  const longAgent = "nathaniel-kirktechsolutions-com"; // 31 chars on its own

  it("leaves a name that already fits untouched", () => {
    assert.equal(managedServerName("google-", "skyler-flatclaw-org"), "google-skyler-flatclaw-org");
    // exactly 30 is still fine
    assert.equal(managedServerName("estimating-", "skyler-flatclaw-org").length, 30);
    assert.equal(managedServerName("estimating-", "skyler-flatclaw-org"), "estimating-skyler-flatclaw-org");
  });

  it("shortens an over-long name to at most 30 characters, keeping the prefix", () => {
    for (const prefix of ["google-", "jira-", "cpanel-", "caldav-"]) {
      const name = managedServerName(prefix, longAgent);
      assert.ok(name.length <= GATEWAY_SERVER_NAME_MAX, `${name} is ${name.length} chars`);
      assert.ok(name.startsWith(prefix));
      assert.match(name, /^[a-z0-9-]+$/);
      assert.notEqual(name, legacyManagedServerName(prefix, longAgent));
    }
  });

  it("is stable, and distinct for agent ids that share a long head", () => {
    const a = managedServerName("google-", "christopher-richardson-acme-corp-com");
    const b = managedServerName("google-", "christopher-richardson-acme-corp-org");
    assert.equal(a, managedServerName("google-", "christopher-richardson-acme-corp-com"));
    assert.notEqual(a, b);
  });

  it("builds the deny glob from the prefix the gateway actually uses", () => {
    const legacy = legacyManagedServerName("google-", longAgent); // 38 chars
    assert.equal(denyPatternForServer(legacy), `${legacy.slice(0, 30)}__*`);
    assert.equal(denyPatternForServer("cpanel-skyler-flatclaw-org"), "cpanel-skyler-flatclaw-org__*");
  });

  it("hides a long-named user's server from everyone else, under either name", () => {
    const modern = managedServerName("google-", longAgent);
    const legacy = legacyManagedServerName("google-", longAgent);
    for (const serverName of [modern, legacy]) {
      const cfg = blob([{ id: longAgent }, { id: "keith-flatclaw-org" }], [serverName]);
      applyManagedToolPolicies(cfg);
      assert.deepEqual(denyOf(cfg, longAgent), [], "the owner keeps its own server");
      const deny = denyOf(cfg, "keith-flatclaw-org");
      assert.equal(deny.length, 1);
      // What the gateway will call the tool, e.g. <first 30 chars>__gmail_search:
      const exposed = gatewayToolName(serverName, "gmail_search");
      assert.ok(exposed.startsWith(deny[0].slice(0, -1)), `${deny[0]} does not cover ${exposed}`);
    }
  });

  it("finds legacy over-long entries so they can be re-registered", () => {
    const legacy = legacyManagedServerName("google-", longAgent);
    const cfg = blob([{ id: longAgent }, { id: "keith-flatclaw-org" }], [legacy, "google-keith-flatclaw-org"]);
    assert.deepEqual(legacyManagedServerNames(cfg, longAgent), [legacy]);
    assert.deepEqual(legacyManagedServerNames(cfg, "keith-flatclaw-org"), []);
  });

  it("names tools the way the gateway does, including the 64-character cap", () => {
    assert.equal(gatewayToolName("cpanel-skyler-flatclaw-org", "list_email_accounts"), "cpanel-skyler-flatclaw-org__list_email_accounts");
    const long = gatewayToolName("google-skyler-flatclaw-org", "a".repeat(80));
    assert.equal(long.length, GATEWAY_TOOL_NAME_MAX);
  });
});
