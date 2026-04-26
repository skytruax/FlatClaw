import type {
  ControlPlaneDomainEvent,
  ControlPlaneOutboxEntry,
  ControlPlaneRuntimeSnapshot,
} from "@/lib/controlplane/contracts";
import { OpenClawGatewayAdapter, type OpenClawAdapterOptions } from "@/lib/controlplane/openclaw-adapter";
import {
  SQLiteControlPlaneProjectionStore,
  type BackfillAgentOutboxResult,
} from "@/lib/controlplane/projection-store";
import { loadStudioSettings } from "@/lib/studio/settings-store";

type ControlPlaneRuntimeOptions = {
  adapterOptions?: OpenClawAdapterOptions;
  dbPath?: string;
};

type EnsureStartedOptions = {
  force?: boolean;
};

export class ControlPlaneRuntime {
  private readonly store: SQLiteControlPlaneProjectionStore;
  private readonly adapter: OpenClawGatewayAdapter;
  private readonly eventSubscribers = new Set<(entry: ControlPlaneOutboxEntry) => void>();
  private autoStartEnabled = true;

  constructor(options?: ControlPlaneRuntimeOptions) {
    this.store = new SQLiteControlPlaneProjectionStore(options?.dbPath);
    this.adapter = new OpenClawGatewayAdapter({
      ...(options?.adapterOptions ?? {}),
      onDomainEvent: (event) => this.handleDomainEvent(event),
    });
  }

  async ensureStarted(options: EnsureStartedOptions = {}): Promise<void> {
    if (options.force) {
      this.autoStartEnabled = true;
    } else if (loadStudioSettings().gatewayAutoStart === false) {
      this.autoStartEnabled = false;
      return;
    } else {
      this.autoStartEnabled = true;
    }
    await this.adapter.start();
  }

  async disconnect(): Promise<void> {
    this.autoStartEnabled = false;
    await this.adapter.stop();
  }

  connectionStatus() {
    return this.adapter.getStatus();
  }

  async reconnectForGatewaySettingsChange(): Promise<void> {
    this.autoStartEnabled = true;
    if (this.adapter.getStatus() === "stopped") {
      await this.adapter.start();
      return;
    }
    await this.adapter.stop();
    await this.adapter.start();
  }

  snapshot(): ControlPlaneRuntimeSnapshot {
    return this.store.snapshot();
  }

  eventsAfter(lastSeenId: number, limit?: number): ControlPlaneOutboxEntry[] {
    return this.store.readOutboxAfter(lastSeenId, limit);
  }

  eventsBeforeForAgent(
    agentId: string,
    beforeOutboxId: number,
    limit?: number
  ): ControlPlaneOutboxEntry[] {
    return this.store.readAgentOutboxBefore(agentId, beforeOutboxId, limit);
  }

  backfillAgentHistoryIndex(beforeOutboxId: number, limit?: number): BackfillAgentOutboxResult {
    return this.store.backfillAgentOutboxBefore(beforeOutboxId, limit);
  }

  subscribe(handler: (entry: ControlPlaneOutboxEntry) => void): () => void {
    this.eventSubscribers.add(handler);
    return () => {
      this.eventSubscribers.delete(handler);
    };
  }

  async callGateway<T = unknown>(
    method: string,
    params: unknown,
    options?: { timeoutMs?: number }
  ): Promise<T> {
    return await this.adapter.request<T>(method, params, options);
  }

  close(): void {
    this.store.close();
  }

  private handleDomainEvent(event: ControlPlaneDomainEvent): void {
    const entry = this.store.applyDomainEvent(event);
    for (const subscriber of this.eventSubscribers) {
      try {
        subscriber(entry);
      } catch (err) {
        console.error("Control-plane event subscriber failed.", err);
      }
    }
  }
}

type GlobalControlPlaneState = typeof globalThis & {
  __openclawStudioControlPlaneRuntime?: ControlPlaneRuntime;
};

export const getControlPlaneRuntime = (options?: ControlPlaneRuntimeOptions): ControlPlaneRuntime => {
  const globalState = globalThis as GlobalControlPlaneState;
  if (!globalState.__openclawStudioControlPlaneRuntime) {
    globalState.__openclawStudioControlPlaneRuntime = new ControlPlaneRuntime(options);
  }
  return globalState.__openclawStudioControlPlaneRuntime;
};

export const peekControlPlaneRuntime = (): ControlPlaneRuntime | null => {
  const globalState = globalThis as GlobalControlPlaneState;
  return globalState.__openclawStudioControlPlaneRuntime ?? null;
};

export const resetControlPlaneRuntimeForTests = (): void => {
  const globalState = globalThis as GlobalControlPlaneState;
  delete globalState.__openclawStudioControlPlaneRuntime;
};

export const isStudioDomainApiModeEnabled = (): boolean => {
  return true;
};
