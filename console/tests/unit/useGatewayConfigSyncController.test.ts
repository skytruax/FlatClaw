import { createElement, useEffect, useState } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGatewayConfigSyncController } from "@/features/agents/operations/useGatewayConfigSyncController";
import type { GatewayModelChoice, GatewayModelPolicySnapshot } from "@/lib/gateway/models";
import { loadDomainConfigSnapshot, loadDomainModels } from "@/lib/controlplane/domain-runtime-client";

vi.mock("@/lib/controlplane/domain-runtime-client", () => ({
  loadDomainConfigSnapshot: vi.fn(),
  loadDomainModels: vi.fn(),
}));

type ProbeValue = {
  gatewayConfigSnapshot: GatewayModelPolicySnapshot | null;
  gatewayModels: GatewayModelChoice[];
  gatewayModelsError: string | null;
  refreshGatewayConfigSnapshot: () => Promise<GatewayModelPolicySnapshot | null>;
};

type RenderControllerContext = {
  getValue: () => ProbeValue;
  rerenderWith: (
    overrides: Partial<{
      status: "disconnected" | "connecting" | "connected";
      settingsRouteActive: boolean;
      inspectSidebarAgentId: string | null;
      logError: (message: string, err: unknown) => void;
    }>
  ) => void;
  logError: (message: string, err: unknown) => void;
};

type RenderControllerParams = {
  status: "disconnected" | "connecting" | "connected";
  settingsRouteActive: boolean;
  inspectSidebarAgentId: string | null;
  initialGatewayConfigSnapshot?: GatewayModelPolicySnapshot | null;
  isDisconnectLikeError: (err: unknown) => boolean;
  logError: (message: string, err: unknown) => void;
};

const renderController = (
  overrides?: Partial<RenderControllerParams>
): RenderControllerContext => {
  const logError = (overrides?.logError ?? vi.fn()) as (message: string, err: unknown) => void;

  let currentParams: RenderControllerParams = {
    status: "connected",
    settingsRouteActive: false,
    inspectSidebarAgentId: null,
    isDisconnectLikeError: overrides?.isDisconnectLikeError ?? (() => false),
    logError,
    ...overrides,
  };

  const valueRef: { current: ProbeValue | null } = { current: null };

  const Probe = ({
    params,
    onValue,
  }: {
    params: typeof currentParams;
    onValue: (value: ProbeValue) => void;
  }) => {
    const [gatewayConfigSnapshot, setGatewayConfigSnapshot] = useState<GatewayModelPolicySnapshot | null>(
      params.initialGatewayConfigSnapshot ?? null
    );
    const [gatewayModels, setGatewayModels] = useState<GatewayModelChoice[]>([]);
    const [gatewayModelsError, setGatewayModelsError] = useState<string | null>(null);

    const { refreshGatewayConfigSnapshot } = useGatewayConfigSyncController({
      status: params.status,
      settingsRouteActive: params.settingsRouteActive,
      inspectSidebarAgentId: params.inspectSidebarAgentId,
      setGatewayConfigSnapshot,
      setGatewayModels,
      setGatewayModelsError,
      isDisconnectLikeError: params.isDisconnectLikeError,
      logError: params.logError,
    });

    useEffect(() => {
      onValue({
        gatewayConfigSnapshot,
        gatewayModels,
        gatewayModelsError,
        refreshGatewayConfigSnapshot,
      });
    }, [gatewayConfigSnapshot, gatewayModels, gatewayModelsError, onValue, refreshGatewayConfigSnapshot]);

    return createElement("div", { "data-testid": "probe" }, "ok");
  };

  const rendered = render(
    createElement(Probe, {
      params: currentParams,
      onValue: (value) => {
        valueRef.current = value;
      },
    })
  );

  return {
    getValue: () => {
      if (!valueRef.current) throw new Error("controller value unavailable");
      return valueRef.current;
    },
    rerenderWith: (nextOverrides) => {
      currentParams = {
        ...currentParams,
        ...nextOverrides,
      };
      rendered.rerender(
        createElement(Probe, {
          params: currentParams,
          onValue: (value) => {
            valueRef.current = value;
          },
        })
      );
    },
    logError,
  };
};

describe("useGatewayConfigSyncController", () => {
  const mockedLoadDomainConfigSnapshot = vi.mocked(loadDomainConfigSnapshot);
  const mockedLoadDomainModels = vi.mocked(loadDomainModels);

  beforeEach(() => {
    mockedLoadDomainConfigSnapshot.mockReset();
    mockedLoadDomainModels.mockReset();
    mockedLoadDomainConfigSnapshot.mockResolvedValue({ config: {} } as GatewayModelPolicySnapshot);
    mockedLoadDomainModels.mockResolvedValue([
      { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
    ]);
  });

  it("clears models, model error, and snapshot when disconnected", async () => {
    const ctx = renderController({ status: "connected" });

    await waitFor(() => {
      expect(ctx.getValue().gatewayModels).toEqual([
        { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
      ]);
    });

    ctx.rerenderWith({ status: "disconnected" });

    await waitFor(() => {
      expect(ctx.getValue().gatewayModels).toEqual([]);
      expect(ctx.getValue().gatewayModelsError).toBeNull();
      expect(ctx.getValue().gatewayConfigSnapshot).toBeNull();
    });
  });

  it("still loads models when config snapshot fetch fails", async () => {
    mockedLoadDomainConfigSnapshot.mockRejectedValue(new Error("config failed"));
    const logError = vi.fn();
    const ctx = renderController({ logError });

    await waitFor(() => {
      expect(ctx.getValue().gatewayModels).toEqual([
        { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
      ]);
    });

    expect(logError).toHaveBeenCalledWith("Failed to load gateway config.", expect.any(Error));
  });

  it("captures model loading errors and clears models", async () => {
    mockedLoadDomainModels.mockRejectedValue(new Error("models unavailable"));
    const logError = vi.fn();
    const ctx = renderController({ logError });

    await waitFor(() => {
      expect(ctx.getValue().gatewayModels).toEqual([]);
      expect(ctx.getValue().gatewayModelsError).toBe("models unavailable");
    });

    expect(logError).toHaveBeenCalledWith("Failed to load gateway models.", expect.any(Error));
  });

  it("runs settings-route refresh only when inspect agent id is present", async () => {
    renderController({
      status: "connected",
      settingsRouteActive: true,
      inspectSidebarAgentId: null,
    });

    await waitFor(() => {
      expect(mockedLoadDomainConfigSnapshot).toHaveBeenCalledTimes(1);
      expect(mockedLoadDomainModels).toHaveBeenCalledTimes(1);
    });

    mockedLoadDomainConfigSnapshot.mockClear();
    mockedLoadDomainModels.mockClear();

    renderController({
      status: "connected",
      settingsRouteActive: true,
      inspectSidebarAgentId: "agent-1",
    });

    await waitFor(() => {
      expect(mockedLoadDomainConfigSnapshot.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(mockedLoadDomainModels).toHaveBeenCalledTimes(1);
    });
  });

  it("returns null when refresh is called while disconnected", async () => {
    const ctx = renderController({ status: "disconnected" });

    const result = await ctx.getValue().refreshGatewayConfigSnapshot();

    expect(result).toBeNull();
    expect(mockedLoadDomainConfigSnapshot).not.toHaveBeenCalled();
  });

  it("loads snapshot from refresh call when connected", async () => {
    const ctx = renderController({ status: "connected" });

    await waitFor(() => {
      expect(mockedLoadDomainConfigSnapshot).toHaveBeenCalled();
    });

    mockedLoadDomainConfigSnapshot.mockClear();
    const refreshed = await ctx.getValue().refreshGatewayConfigSnapshot();

    expect(refreshed).toEqual({ config: {} });
    expect(mockedLoadDomainConfigSnapshot).toHaveBeenCalledTimes(1);
  });

  it("suppresses logs for disconnect-like model errors", async () => {
    mockedLoadDomainModels.mockRejectedValue(new Error("socket closed"));
    const logError = vi.fn();

    renderController({
      isDisconnectLikeError: () => true,
      logError,
    });

    await waitFor(() => {
      expect(mockedLoadDomainModels).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(logError).not.toHaveBeenCalledWith("Failed to load gateway models.", expect.anything());
  });
});
