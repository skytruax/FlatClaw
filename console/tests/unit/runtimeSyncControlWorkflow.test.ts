import { describe, expect, it } from "vitest";

import {
  RUNTIME_SYNC_MAX_HISTORY_LIMIT,
  RUNTIME_SYNC_RECONCILE_INTERVAL_MS,
  resolveRuntimeSyncBootstrapHistoryAgentIds,
  resolveRuntimeSyncGapRecoveryIntent,
  resolveRuntimeSyncLoadMoreHistoryLimit,
  resolveRuntimeSyncReconcilePollingIntent,
} from "@/features/agents/operations/runtimeSyncControlWorkflow";

describe("runtimeSyncControlWorkflow", () => {
  it("plans reconcile polling only when connected", () => {
    expect(
      resolveRuntimeSyncReconcilePollingIntent({
        status: "disconnected",
      })
    ).toEqual({
      kind: "stop",
      reason: "not-connected",
    });

    expect(
      resolveRuntimeSyncReconcilePollingIntent({
        status: "connected",
      })
    ).toEqual({
      kind: "start",
      intervalMs: RUNTIME_SYNC_RECONCILE_INTERVAL_MS,
      runImmediately: true,
    });
  });

  it("plans history bootstrap for connected unloaded sessions", () => {
    expect(
      resolveRuntimeSyncBootstrapHistoryAgentIds({
        status: "connected",
        agents: [
          { agentId: "agent-1", sessionCreated: true, historyLoadedAt: null },
          { agentId: "agent-2", sessionCreated: true, historyLoadedAt: 1234 },
          { agentId: "agent-3", sessionCreated: false, historyLoadedAt: null },
        ],
      })
    ).toEqual(["agent-1"]);

    expect(
      resolveRuntimeSyncBootstrapHistoryAgentIds({
        status: "connecting",
        agents: [{ agentId: "agent-1", sessionCreated: true, historyLoadedAt: null }],
      })
    ).toEqual([]);
  });

  it("resolves load-more limits with floor and max bounds", () => {
    expect(
      resolveRuntimeSyncLoadMoreHistoryLimit({
        currentLimit: 200,
        defaultLimit: 200,
        maxLimit: RUNTIME_SYNC_MAX_HISTORY_LIMIT,
      })
    ).toBe(400);

    expect(
      resolveRuntimeSyncLoadMoreHistoryLimit({
        currentLimit: 3000,
        defaultLimit: 200,
        maxLimit: RUNTIME_SYNC_MAX_HISTORY_LIMIT,
      })
    ).toBe(1000);

    expect(
      resolveRuntimeSyncLoadMoreHistoryLimit({
        currentLimit: 20,
        defaultLimit: 50,
        maxLimit: RUNTIME_SYNC_MAX_HISTORY_LIMIT,
      })
    ).toBe(100);

    expect(
      resolveRuntimeSyncLoadMoreHistoryLimit({
        currentLimit: null,
        defaultLimit: 50,
        maxLimit: RUNTIME_SYNC_MAX_HISTORY_LIMIT,
      })
    ).toBe(100);
  });

  it("always plans summary refresh plus reconcile for gap recovery", () => {
    expect(resolveRuntimeSyncGapRecoveryIntent()).toEqual({
      refreshSummarySnapshot: true,
      reconcileRunningAgents: true,
    });
  });
});
