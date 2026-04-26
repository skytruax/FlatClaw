// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const makeTempDir = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));

describe("studio settings route reconnect behavior", () => {
  const priorStateDir = process.env.OPENCLAW_STATE_DIR;
  let tempDir: string | null = null;

  afterEach(() => {
    process.env.OPENCLAW_STATE_DIR = priorStateDir;
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("restarts a manually disconnected runtime when settings are saved without changing the gateway", async () => {
    tempDir = makeTempDir("studio-settings-reconnect-stopped-runtime");
    process.env.OPENCLAW_STATE_DIR = tempDir;
    fs.mkdirSync(path.join(tempDir, "flatclaw-console"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "flatclaw-console", "settings.json"),
      JSON.stringify(
        {
          version: 1,
          gateway: { url: "ws://remote.example:18789", token: "secret-token" },
          focused: {},
          avatars: {},
        },
        null,
        2
      ),
      "utf8"
    );

    const ensureStarted = vi.fn(async () => {});
    const reconnectForGatewaySettingsChange = vi.fn(async () => {});
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      peekControlPlaneRuntime: () => ({
        connectionStatus: () => "stopped",
        ensureStarted,
        reconnectForGatewaySettingsChange,
      }),
      getControlPlaneRuntime: () => ({
        connectionStatus: () => "stopped",
        ensureStarted,
        reconnectForGatewaySettingsChange,
      }),
    }));

    const { PUT } = await import("@/app/api/studio/route");
    const response = await PUT({
      json: async () => ({
        gateway: { url: "ws://remote.example:18789" },
      }),
    } as unknown as Request);

    expect(response.status).toBe(200);
    expect(ensureStarted).toHaveBeenCalledWith({ force: true });
    expect(reconnectForGatewaySettingsChange).not.toHaveBeenCalled();

    const body = (await response.json()) as {
      runtimeReconnect?: {
        attempted?: unknown;
        restarted?: unknown;
        previousStatus?: unknown;
      } | null;
    };
    expect(body.runtimeReconnect).toEqual({
      attempted: true,
      restarted: true,
      previousStatus: "stopped",
    });
  });

  it("persists manual disconnect across requests", async () => {
    tempDir = makeTempDir("studio-settings-disconnect-pause");
    process.env.OPENCLAW_STATE_DIR = tempDir;
    fs.mkdirSync(path.join(tempDir, "flatclaw-console"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "flatclaw-console", "settings.json"),
      JSON.stringify(
        {
          version: 1,
          gateway: { url: "ws://remote.example:18789", token: "secret-token" },
          gatewayAutoStart: true,
          focused: {},
          avatars: {},
        },
        null,
        2
      ),
      "utf8"
    );

    vi.doMock("@/lib/controlplane/runtime", () => ({
      peekControlPlaneRuntime: () => null,
    }));

    const { POST } = await import("@/app/api/runtime/disconnect/route");
    const response = await POST();
    expect(response.status).toBe(200);

    const persisted = JSON.parse(
      fs.readFileSync(path.join(tempDir, "flatclaw-console", "settings.json"), "utf8")
    ) as { gatewayAutoStart?: boolean };
    expect(persisted.gatewayAutoStart).toBe(false);
  });

  it("creates and starts a runtime when save settings is the first reconnect request", async () => {
    tempDir = makeTempDir("studio-settings-start-missing-runtime");
    process.env.OPENCLAW_STATE_DIR = tempDir;
    fs.mkdirSync(path.join(tempDir, "flatclaw-console"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "flatclaw-console", "settings.json"),
      JSON.stringify(
        {
          version: 1,
          gateway: { url: "ws://remote.example:18789", token: "secret-token" },
          gatewayAutoStart: false,
          focused: {},
          avatars: {},
        },
        null,
        2
      ),
      "utf8"
    );

    const ensureStarted = vi.fn(async () => {});
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      peekControlPlaneRuntime: () => null,
      getControlPlaneRuntime: () => ({
        connectionStatus: () => "stopped",
        ensureStarted,
        reconnectForGatewaySettingsChange: vi.fn(async () => {}),
      }),
    }));

    const { PUT } = await import("@/app/api/studio/route");
    const response = await PUT({
      json: async () => ({
        gateway: { url: "ws://remote.example:18789" },
      }),
    } as unknown as Request);

    expect(response.status).toBe(200);
    expect(ensureStarted).toHaveBeenCalledWith({ force: true });

    const persisted = JSON.parse(
      fs.readFileSync(path.join(tempDir, "flatclaw-console", "settings.json"), "utf8")
    ) as { gatewayAutoStart?: boolean };
    expect(persisted.gatewayAutoStart).toBe(true);
  });
});
