import { describe, expect, it, vi } from "vitest";

import type { AgentState } from "@/features/agents/state/store";
import type { EventFrame } from "@/lib/gateway/GatewayClient";

const workflowMocks = vi.hoisted(() => ({
  planRuntimeChatEvent: vi.fn(),
  planRuntimeAgentEvent: vi.fn(),
}));

vi.mock("@/features/agents/state/runtimeChatEventWorkflow", () => ({
  planRuntimeChatEvent: workflowMocks.planRuntimeChatEvent,
}));

vi.mock("@/features/agents/state/runtimeAgentEventWorkflow", () => ({
  planRuntimeAgentEvent: workflowMocks.planRuntimeAgentEvent,
}));

import { createGatewayRuntimeEventHandler } from "@/features/agents/state/gatewayRuntimeEventHandler";

const createAgent = (overrides?: Partial<AgentState>): AgentState => ({
  agentId: "agent-1",
  name: "Agent One",
  sessionKey: "agent:agent-1:studio:test-session",
  status: "running",
  sessionCreated: true,
  awaitingUserInput: false,
  hasUnseenActivity: false,
  outputLines: [],
  lastResult: null,
  lastDiff: null,
  runId: "run-1",
  runStartedAt: 900,
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
  ...(overrides ?? {}),
});

describe("gateway runtime event handler policy delegation", () => {
  it("routes runtime chat events through chat workflow commands", () => {
    workflowMocks.planRuntimeChatEvent.mockReturnValue({
      commands: [
        {
          kind: "applyPolicyIntents",
          intents: [
            {
              kind: "queueLivePatch",
              agentId: "agent-1",
              patch: { streamText: "from-chat-workflow", status: "running" },
            },
          ],
        },
      ],
    });
    workflowMocks.planRuntimeAgentEvent.mockReturnValue({ commands: [] });

    const queueLivePatch = vi.fn();
    const handler = createGatewayRuntimeEventHandler({
      getAgents: () => [createAgent()],
      dispatch: vi.fn(),
      queueLivePatch,
      clearPendingLivePatch: vi.fn(),
      requestHistoryRefresh: vi.fn(async () => {}),
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      updateSpecialLatestUpdate: vi.fn(),
    });

    const event: EventFrame = {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: "agent:agent-1:studio:test-session",
        state: "delta",
        message: { role: "assistant", content: "raw" },
      },
    };

    handler.handleEvent(event);

    expect(workflowMocks.planRuntimeChatEvent).toHaveBeenCalledTimes(1);
    expect(queueLivePatch).toHaveBeenCalledWith("agent-1", {
      streamText: "from-chat-workflow",
      status: "running",
    });
  });

  it("routes runtime agent events through agent workflow commands", () => {
    workflowMocks.planRuntimeChatEvent.mockReturnValue({ commands: [] });
    workflowMocks.planRuntimeAgentEvent.mockReturnValue({
      commands: [
        {
          kind: "applyPolicyIntents",
          intents: [{ kind: "ignore", reason: "forced" }],
        },
      ],
    });

    const dispatch = vi.fn();
    const handler = createGatewayRuntimeEventHandler({
      getAgents: () => [createAgent()],
      dispatch,
      queueLivePatch: vi.fn(),
      clearPendingLivePatch: vi.fn(),
      requestHistoryRefresh: vi.fn(async () => {}),
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      updateSpecialLatestUpdate: vi.fn(),
    });

    handler.handleEvent({
      type: "event",
      event: "agent",
      payload: {
        runId: "run-1",
        sessionKey: "agent:agent-1:studio:test-session",
        stream: "assistant",
        data: { delta: "raw" },
      },
    } as EventFrame);

    expect(workflowMocks.planRuntimeAgentEvent).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
