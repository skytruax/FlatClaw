import { useCallback, useEffect } from "react";

import {
  resolveGatewayModelsSyncIntent,
  shouldRefreshGatewayConfigForSettingsRoute,
  type GatewayConnectionStatus,
} from "@/features/agents/operations/gatewayConfigSyncWorkflow";
import {
  buildGatewayModelChoices,
  type GatewayModelChoice,
  type GatewayModelPolicySnapshot,
} from "@/lib/gateway/models";
import { loadDomainConfigSnapshot, loadDomainModels } from "@/lib/controlplane/domain-runtime-client";

const defaultLogError = (message: string, err: unknown) => {
  console.error(message, err);
};

type UseGatewayConfigSyncControllerParams = {
  status: GatewayConnectionStatus;
  settingsRouteActive: boolean;
  inspectSidebarAgentId: string | null;
  setGatewayConfigSnapshot: (snapshot: GatewayModelPolicySnapshot | null) => void;
  setGatewayModels: (models: GatewayModelChoice[]) => void;
  setGatewayModelsError: (message: string | null) => void;
  isDisconnectLikeError: (err: unknown) => boolean;
  logError?: (message: string, err: unknown) => void;
};

type GatewayConfigSyncController = {
  refreshGatewayConfigSnapshot: () => Promise<GatewayModelPolicySnapshot | null>;
};

export function useGatewayConfigSyncController(
  params: UseGatewayConfigSyncControllerParams
): GatewayConfigSyncController {
  const {
    status,
    settingsRouteActive,
    inspectSidebarAgentId,
    setGatewayConfigSnapshot,
    setGatewayModels,
    setGatewayModelsError,
    isDisconnectLikeError,
  } = params;

  const logError = params.logError ?? defaultLogError;

  const refreshGatewayConfigSnapshot = useCallback(async () => {
    if (status !== "connected") return null;
    try {
      const snapshot = await loadDomainConfigSnapshot();
      setGatewayConfigSnapshot(snapshot);
      return snapshot;
    } catch (err) {
      if (!isDisconnectLikeError(err)) {
        logError("Failed to refresh gateway config.", err);
      }
      return null;
    }
  }, [isDisconnectLikeError, logError, setGatewayConfigSnapshot, status]);

  useEffect(() => {
    if (
      !shouldRefreshGatewayConfigForSettingsRoute({
        status,
        settingsRouteActive,
        inspectSidebarAgentId,
      })
    ) {
      return;
    }
    void refreshGatewayConfigSnapshot();
  }, [inspectSidebarAgentId, refreshGatewayConfigSnapshot, settingsRouteActive, status]);

  useEffect(() => {
    const syncIntent = resolveGatewayModelsSyncIntent({ status });
    if (syncIntent.kind === "clear") {
      setGatewayModels([]);
      setGatewayModelsError(null);
      setGatewayConfigSnapshot(null);
      return;
    }

    let cancelled = false;
    const loadModels = async () => {
      let configSnapshot: GatewayModelPolicySnapshot | null = null;
      try {
        configSnapshot = await loadDomainConfigSnapshot();
        if (!cancelled) {
          setGatewayConfigSnapshot(configSnapshot);
        }
      } catch (err) {
        if (!isDisconnectLikeError(err)) {
          logError("Failed to load gateway config.", err);
        }
      }

      try {
        const catalog = await loadDomainModels();
        if (cancelled) return;
        setGatewayModels(buildGatewayModelChoices(catalog, configSnapshot));
        setGatewayModelsError(null);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load models.";
        setGatewayModelsError(message);
        setGatewayModels([]);
        if (!isDisconnectLikeError(err)) {
          logError("Failed to load gateway models.", err);
        }
      }
    };

    void loadModels();
    return () => {
      cancelled = true;
    };
  }, [
    isDisconnectLikeError,
    logError,
    setGatewayConfigSnapshot,
    setGatewayModels,
    setGatewayModelsError,
    status,
  ]);

  return {
    refreshGatewayConfigSnapshot,
  };
}
