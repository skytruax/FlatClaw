import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyManagedToolPolicies,
  denyPatternForServer,
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
 * Run with:
 *   npx tsx --test lib/openclaw/agent-tool-policy.test.ts
 *
 * Or via the portal package script (once we wire one up).
 */

function blob(
  agents: Array<{ id: string; tools?: { deny?: string[] } }>,
  serverNames: string[],
): ConfigBlob {
  const servers: Record<string, { command?: string }> = {};
  for (const n of serverNames) servers[n] = { command: "node" };
  return {
    agents: { list: agents },
    mcp: { servers },
  };
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
    const get = (id: string) =>
      cfg.agents!.list!.find((a) => a.id === id)!.tools?.deny ?? [];
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
    const deny = cfg.agents!.list![0].tools!.deny!;
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
    assert.deepEqual(cfg.agents!.list![0].tools!.deny, ["operator-deny"]);
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
    const entry = cfg.agents!.list![0];
    assert.equal(entry.tools, undefined);
  });

  it("ignores third-party MCP servers (non-managed names)", () => {
    const cfg = blob(
      [{ id: "skyler-flatclaw-org" }, { id: "keith-flatclaw-org" }],
      ["thirdparty-tool", "context7", "cpanel-skyler-flatclaw-org"],
    );
    applyManagedToolPolicies(cfg);
    const keith = cfg.agents!.list!.find((a) => a.id === "keith-flatclaw-org")!;
    // Only the managed server appears in deny.
    assert.deepEqual(keith.tools!.deny, [
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
    const get = (id: string) =>
      cfg.agents!.list!.find((x) => x.id === id)!.tools?.deny ?? [];
    // cpanel-shared-ftp is NOT denied for anyone.
    for (const id of ["a", "b"]) {
      assert.ok(!get(id).includes("cpanel-shared-ftp__*"));
    }
    // caldav-a is still per-user.
    assert.deepEqual(get("b"), ["caldav-a__*"]);
  });
});
