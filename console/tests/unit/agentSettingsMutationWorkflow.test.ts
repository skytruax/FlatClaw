import { describe, expect, it } from "vitest";

import {
  planAgentSettingsMutation,
  type AgentSettingsMutationContext,
} from "@/features/agents/operations/agentSettingsMutationWorkflow";

const createContext = (
  overrides?: Partial<AgentSettingsMutationContext>
): AgentSettingsMutationContext => ({
  status: "connected",
  hasCreateBlock: false,
  hasRenameBlock: false,
  hasDeleteBlock: false,
  cronCreateBusy: false,
  cronRunBusyJobId: null,
  cronDeleteBusyJobId: null,
  ...(overrides ?? {}),
});

describe("agentSettingsMutationWorkflow", () => {
  it("denies guarded actions when not connected", () => {
    const renameResult = planAgentSettingsMutation(
      { kind: "rename-agent", agentId: "agent-1" },
      createContext({ status: "disconnected" })
    );

    expect(renameResult).toEqual({
      kind: "deny",
      reason: "start-guard-deny",
      message: null,
      guardReason: "not-connected",
    });
  });

  it("denies delete for reserved main agent", () => {
    const result = planAgentSettingsMutation(
      { kind: "delete-agent", agentId: " main " },
      createContext()
    );

    expect(result).toEqual({
      kind: "deny",
      reason: "reserved-main-delete",
      message: "The main agent cannot be deleted.",
    });
  });

  it("denies cron mutations when another cron action is busy", () => {
    const result = planAgentSettingsMutation(
      { kind: "run-cron-job", agentId: "agent-1", jobId: "job-1" },
      createContext({ cronDeleteBusyJobId: "job-2" })
    );

    expect(result).toEqual({
      kind: "deny",
      reason: "cron-action-busy",
      message: null,
    });
  });

  it("allows with normalized agent and job ids", () => {
    const runResult = planAgentSettingsMutation(
      { kind: "run-cron-job", agentId: " agent-1 ", jobId: " job-1 " },
      createContext()
    );
    const deleteResult = planAgentSettingsMutation(
      { kind: "delete-agent", agentId: " agent-2 " },
      createContext()
    );

    expect(runResult).toEqual({
      kind: "allow",
      normalizedAgentId: "agent-1",
      normalizedJobId: "job-1",
    });
    expect(deleteResult).toEqual({
      kind: "allow",
      normalizedAgentId: "agent-2",
    });
  });
});
