import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentStoreSeed } from "@/features/agents/state/store";
import type { GatewayModelPolicySnapshot } from "@/lib/gateway/models";
import type { StudioSettingsPatch } from "@/lib/studio/settings";
import { fetchJson } from "@/lib/http";

vi.mock("@/lib/http", () => ({
  fetchJson: vi.fn(),
}));

import {
  executeStudioBootstrapLoadCommands,
  executeStudioFocusedPatchCommands,
  executeStudioFocusedPreferenceLoadCommands,
  runStudioBootstrapLoadOperation,
  runStudioFocusFilterPersistenceOperation,
  runStudioFocusedPreferenceLoadOperation,
  runStudioFocusedSelectionPersistenceOperation,
  type StudioBootstrapLoadCommand,
} from "@/features/agents/operations/studioBootstrapOperation";

const fetchJsonMock = vi.mocked(fetchJson);

describe("studioBootstrapOperation", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("builds bootstrap commands from runtime fleet result", async () => {
    const seeds: AgentStoreSeed[] = [
      {
        agentId: "agent-1",
        name: "Agent One",
        sessionKey: "agent:agent-1:main",
      },
      {
        agentId: "agent-2",
        name: "Agent Two",
        sessionKey: "agent:agent-2:main",
      },
    ];
    const snapshot = { config: {} } as GatewayModelPolicySnapshot;

    fetchJsonMock.mockResolvedValue({
      result: {
        seeds,
        sessionCreatedAgentIds: ["agent-1"],
        sessionSettingsSyncedAgentIds: ["agent-1"],
        summaryPatches: [{ agentId: "agent-2", patch: { latestPreview: "hello" } }],
        suggestedSelectedAgentId: "agent-2",
        configSnapshot: snapshot,
      },
    });

    const commands = await runStudioBootstrapLoadOperation({
      cachedConfigSnapshot: null,
      preferredSelectedAgentId: "agent-1",
      hasCurrentSelection: false,
    });

    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/runtime/fleet",
      expect.objectContaining({ method: "POST", cache: "no-store" })
    );
    expect(commands).toEqual([
      { kind: "set-gateway-config-snapshot", snapshot },
      {
        kind: "hydrate-agents",
        seeds,
        initialSelectedAgentId: "agent-1",
      },
      {
        kind: "mark-session-created",
        agentId: "agent-1",
        sessionSettingsSynced: true,
      },
      {
        kind: "apply-summary-patch",
        agentId: "agent-2",
        patch: { latestPreview: "hello" },
      },
    ]);
  });

  it("returns set-error command when runtime fleet fetch fails", async () => {
    fetchJsonMock.mockRejectedValue(new Error("load failed"));

    const commands = await runStudioBootstrapLoadOperation({
      cachedConfigSnapshot: null,
      preferredSelectedAgentId: null,
      hasCurrentSelection: false,
    });

    expect(commands).toEqual([{ kind: "set-error", message: "load failed" }]);
  });

  it("hydrates agents from degraded runtime fleet payload", async () => {
    const seeds: AgentStoreSeed[] = [{ agentId: "agent-1", name: "Recovered", sessionKey: "s1" }];
    fetchJsonMock.mockResolvedValue({
      enabled: true,
      degraded: true,
      error: "gateway unavailable",
      freshness: {
        source: "projection",
        stale: true,
        asOf: "2026-02-28T02:40:00.000Z",
        reason: "gateway_unavailable",
      },
      result: {
        seeds,
        sessionCreatedAgentIds: ["agent-1"],
        sessionSettingsSyncedAgentIds: [],
        summaryPatches: [],
        suggestedSelectedAgentId: "agent-1",
        configSnapshot: null,
      },
    });

    const commands = await runStudioBootstrapLoadOperation({
      cachedConfigSnapshot: null,
      preferredSelectedAgentId: null,
      hasCurrentSelection: false,
    });

    expect(commands).toEqual([
      {
        kind: "hydrate-agents",
        seeds,
        initialSelectedAgentId: "agent-1",
      },
      {
        kind: "mark-session-created",
        agentId: "agent-1",
        sessionSettingsSynced: false,
      },
    ]);
  });

  it("executes bootstrap commands with injected callbacks", () => {
    const commands: StudioBootstrapLoadCommand[] = [
      {
        kind: "set-gateway-config-snapshot",
        snapshot: { config: {} } as GatewayModelPolicySnapshot,
      },
      {
        kind: "hydrate-agents",
        seeds: [{ agentId: "agent-1", name: "Agent One", sessionKey: "s1" }],
        initialSelectedAgentId: "agent-1",
      },
      {
        kind: "mark-session-created",
        agentId: "agent-1",
        sessionSettingsSynced: true,
      },
      {
        kind: "apply-summary-patch",
        agentId: "agent-1",
        patch: { latestPreview: "preview" },
      },
      {
        kind: "set-error",
        message: "failed",
      },
    ];

    const setGatewayConfigSnapshot = vi.fn();
    const hydrateAgents = vi.fn();
    const dispatchUpdateAgent = vi.fn();
    const setError = vi.fn();

    executeStudioBootstrapLoadCommands({
      commands,
      setGatewayConfigSnapshot,
      hydrateAgents,
      dispatchUpdateAgent,
      setError,
    });

    expect(setGatewayConfigSnapshot).toHaveBeenCalledTimes(1);
    expect(hydrateAgents).toHaveBeenCalledWith(
      [{ agentId: "agent-1", name: "Agent One", sessionKey: "s1" }],
      "agent-1"
    );
    expect(dispatchUpdateAgent).toHaveBeenCalledWith("agent-1", {
      sessionCreated: true,
      sessionSettingsSynced: true,
    });
    expect(dispatchUpdateAgent).toHaveBeenCalledWith("agent-1", { latestPreview: "preview" });
    expect(setError).toHaveBeenCalledWith("failed");
  });

  it("loads focused preference and emits restore commands", async () => {
    const commands = await runStudioFocusedPreferenceLoadOperation({
      gatewayUrl: "https://gateway.test",
      loadStudioSettings: async () => ({
        version: 1,
        gateway: null,
        gatewayAutoStart: true,
        focused: {
          "https://gateway.test": {
            mode: "focused",
            selectedAgentId: "agent-9",
            filter: "running",
          },
        },
        avatars: {},
      }),
      isFocusFilterTouched: () => false,
    });

    expect(commands).toEqual([
      {
        kind: "set-preferred-selected-agent-id",
        agentId: "agent-9",
      },
      {
        kind: "set-focus-filter",
        filter: "all",
      },
      {
        kind: "set-focused-preferences-loaded",
        value: true,
      },
    ]);
  });

  it("skips focused preference restore when user touched filter during load", async () => {
    const commands = await runStudioFocusedPreferenceLoadOperation({
      gatewayUrl: "https://gateway.test",
      loadStudioSettings: async () => ({
        version: 1,
        gateway: null,
        gatewayAutoStart: true,
        focused: {
          "https://gateway.test": {
            mode: "focused",
            selectedAgentId: "agent-9",
            filter: "running",
          },
        },
        avatars: {},
      }),
      isFocusFilterTouched: () => true,
    });

    expect(commands).toEqual([
      {
        kind: "set-focused-preferences-loaded",
        value: true,
      },
    ]);
  });

  it("returns focused preference load error command on failure", async () => {
    const commands = await runStudioFocusedPreferenceLoadOperation({
      gatewayUrl: "https://gateway.test",
      loadStudioSettings: async () => {
        throw new Error("settings failed");
      },
      isFocusFilterTouched: () => false,
    });

    expect(commands[0]).toMatchObject({
      kind: "log-error",
      message: "Failed to load focused preference.",
    });
    expect(commands[1]).toEqual({
      kind: "set-focused-preferences-loaded",
      value: true,
    });
  });

  it("executes focused preference load commands", () => {
    const setFocusedPreferencesLoaded = vi.fn();
    const setPreferredSelectedAgentId = vi.fn();
    const setFocusFilter = vi.fn();
    const logError = vi.fn();

    executeStudioFocusedPreferenceLoadCommands({
      commands: [
        { kind: "set-focused-preferences-loaded", value: false },
        { kind: "set-preferred-selected-agent-id", agentId: "agent-1" },
        { kind: "set-focus-filter", filter: "approvals" },
        { kind: "log-error", message: "failed", error: new Error("boom") },
      ],
      setFocusedPreferencesLoaded,
      setPreferredSelectedAgentId,
      setFocusFilter,
      logError,
    });

    expect(setFocusedPreferencesLoaded).toHaveBeenCalledWith(false);
    expect(setPreferredSelectedAgentId).toHaveBeenCalledWith("agent-1");
    expect(setFocusFilter).toHaveBeenCalledWith("approvals");
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("plans focused persistence patch commands and executes scheduler/immediate persistence", async () => {
    const filterCommands = runStudioFocusFilterPersistenceOperation({
      gatewayUrl: "https://gateway.test",
      focusFilterTouched: true,
      focusFilter: "running",
    });
    const selectionCommands = runStudioFocusedSelectionPersistenceOperation({
      gatewayUrl: "https://gateway.test",
      status: "connected",
      focusedPreferencesLoaded: true,
      agentsLoadedOnce: true,
      selectedAgentId: "agent-2",
    });

    const schedulePatch = vi.fn();
    const applyPatchNow = vi.fn(async () => {});
    executeStudioFocusedPatchCommands({
      commands: [...filterCommands, ...selectionCommands],
      schedulePatch,
      applyPatchNow,
    });

    await Promise.resolve();

    expect(schedulePatch).toHaveBeenCalledTimes(1);
    const firstCall = schedulePatch.mock.calls[0] as [StudioSettingsPatch, number];
    expect(firstCall[1]).toBe(300);
    expect(applyPatchNow).toHaveBeenCalledTimes(1);
    expect(applyPatchNow).toHaveBeenCalledWith({
      focused: {
        "https://gateway.test": {
          mode: "focused",
          selectedAgentId: "agent-2",
        },
      },
    });
  });

  it("skips focused selected-agent persistence command when unchanged", () => {
    const selectionCommands = runStudioFocusedSelectionPersistenceOperation({
      gatewayUrl: "https://gateway.test",
      status: "connected",
      focusedPreferencesLoaded: true,
      agentsLoadedOnce: true,
      selectedAgentId: "agent-2",
      lastPersistedSelectedAgentId: "agent-2",
    });

    expect(selectionCommands).toEqual([]);
  });
});
