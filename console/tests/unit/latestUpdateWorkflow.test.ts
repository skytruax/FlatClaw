import { describe, expect, it } from "vitest";

import {
  buildLatestUpdateTriggerMarker,
  buildLatestUpdatePatch,
  resolveLatestUpdateIntent,
  resolveLatestUpdateKind,
} from "@/features/agents/operations/latestUpdateWorkflow";

describe("latestUpdateWorkflow", () => {
  it("resolves latest-update kind as heartbeat, cron, or none from message content", () => {
    expect(resolveLatestUpdateKind("")).toBeNull();
    expect(resolveLatestUpdateKind("check heartbeat status")).toBe("heartbeat");
    expect(resolveLatestUpdateKind("cron report pending")).toBe("cron");
    expect(resolveLatestUpdateKind("heartbeat then cron")).toBe("cron");
    expect(resolveLatestUpdateKind("cron then heartbeat")).toBe("heartbeat");
  });

  it("returns reset intent when no latest-update kind is present and existing override is set", () => {
    expect(
      resolveLatestUpdateIntent({
        message: "plain user prompt",
        agentId: "agent-1",
        sessionKey: "agent:agent-1:main",
        hasExistingOverride: true,
      })
    ).toEqual({ kind: "reset" });
    expect(
      resolveLatestUpdateIntent({
        message: "plain user prompt",
        agentId: "agent-1",
        sessionKey: "agent:agent-1:main",
        hasExistingOverride: false,
      })
    ).toEqual({ kind: "noop" });
  });

  it("returns heartbeat fetch intent with fallback session strategy", () => {
    expect(
      resolveLatestUpdateIntent({
        message: "heartbeat please",
        agentId: "",
        sessionKey: "agent:fallback-agent:main",
        hasExistingOverride: false,
      })
    ).toEqual({
      kind: "fetch-heartbeat",
      agentId: "fallback-agent",
      sessionLimit: 48,
      historyLimit: 200,
    });
    expect(
      resolveLatestUpdateIntent({
        message: "heartbeat please",
        agentId: "",
        sessionKey: "invalid",
        hasExistingOverride: false,
      })
    ).toEqual({ kind: "reset" });
  });

  it("maps fetched content into latest override patch semantics", () => {
    expect(buildLatestUpdatePatch("", "heartbeat")).toEqual({
      latestOverride: null,
      latestOverrideKind: null,
    });
    expect(buildLatestUpdatePatch("Heartbeat is healthy.", "heartbeat")).toEqual({
      latestOverride: "Heartbeat is healthy.",
      latestOverrideKind: "heartbeat",
    });
  });

  it("builds trigger markers that refresh heartbeat/cron prompts when assistant completion time changes", () => {
    expect(
      buildLatestUpdateTriggerMarker({
        message: "plain prompt",
        lastAssistantMessageAt: 1700000000000,
      })
    ).toBe("plain prompt");

    expect(
      buildLatestUpdateTriggerMarker({
        message: "heartbeat please",
        lastAssistantMessageAt: 1700000000000,
      })
    ).toBe("heartbeat please:1700000000000");

    expect(
      buildLatestUpdateTriggerMarker({
        message: "cron report",
        lastAssistantMessageAt: null,
      })
    ).toBe("cron report:");
  });
});
