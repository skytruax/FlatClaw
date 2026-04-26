import { describe, expect, it, vi } from "vitest";

import { createGatewayRuntimeEventHandler } from "@/features/agents/state/gatewayRuntimeEventHandler";
import type { AgentState } from "@/features/agents/state/store";

const createAgent = (): AgentState => ({
  agentId: "agent-1",
  name: "Agent One",
  sessionKey: "agent:agent-1:studio:test-session",
  status: "idle",
  sessionCreated: true,
  awaitingUserInput: false,
  hasUnseenActivity: false,
  outputLines: [],
  lastResult: null,
  lastDiff: null,
  runId: null,
  runStartedAt: null,
  streamText: null,
  thinkingTrace: null,
  latestOverride: null,
  latestOverrideKind: null,
  lastAssistantMessageAt: null,
  lastActivityAt: null,
  latestPreview: null,
  lastUserMessage: null,
  draft: "",
  sessionSettingsSynced: true,
  historyLoadedAt: null,
  historyFetchLimit: null,
  historyFetchedCount: null,
  historyMaybeTruncated: false,
  toolCallingEnabled: true,
  showThinkingTraces: true,
  model: "openai/gpt-5",
  thinkingLevel: "medium",
  avatarSeed: "seed-1",
  avatarUrl: null,
});

describe("gateway runtime event handler (summary refresh)", () => {
  it("ignores presence/heartbeat summary-refresh events", () => {
    const dispatch = vi.fn();
    const queueLivePatch = vi.fn();
    const requestHistoryRefresh = vi.fn(async () => {});

    const handler = createGatewayRuntimeEventHandler({
      getAgents: () => [createAgent()],
      dispatch,
      queueLivePatch,
      clearPendingLivePatch: vi.fn(),
      requestHistoryRefresh,
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      updateSpecialLatestUpdate: vi.fn(),
    });

    handler.handleEvent({ type: "event", event: "presence", payload: {} });
    handler.handleEvent({ type: "event", event: "heartbeat", payload: {} });

    expect(dispatch).not.toHaveBeenCalled();
    expect(queueLivePatch).not.toHaveBeenCalled();
    expect(requestHistoryRefresh).not.toHaveBeenCalled();

    handler.dispose();
  });
});
