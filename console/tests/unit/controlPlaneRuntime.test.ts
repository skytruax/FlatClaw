// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ControlPlaneRuntime,
  getControlPlaneRuntime,
  isStudioDomainApiModeEnabled,
  resetControlPlaneRuntimeForTests,
} from "@/lib/controlplane/runtime";

const closeWebSocketServer = (server: WebSocketServer) =>
  new Promise<void>((resolve) => server.close(() => resolve()));

describe("control-plane runtime", () => {
  let tempDir: string | null = null;

  const makeRuntimeDbPath = () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "controlplane-runtime-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    fs.mkdirSync(path.join(tempDir, "flatclaw-console"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "flatclaw-console", "settings.json"),
      JSON.stringify(
        {
          version: 1,
          gateway: { url: "ws://127.0.0.1:0", token: "placeholder" },
          gatewayAutoStart: true,
          focused: {},
          avatars: {},
        },
        null,
        2
      ),
      "utf8"
    );
    return path.join(tempDir, "runtime.db");
  };

  afterEach(async () => {
    const runtime = getControlPlaneRuntime();
    await runtime.disconnect();
    runtime.close();
    resetControlPlaneRuntimeForTests();
    delete process.env.OPENCLAW_STATE_DIR;
    delete process.env.STUDIO_DOMAIN_API_MODE;
    delete process.env.NEXT_PUBLIC_STUDIO_DOMAIN_API_MODE;
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("connects and disconnects through adapter lifecycle", async () => {
    const upstream = new WebSocketServer({ port: 0 });
    const address = upstream.address();
    if (!address || typeof address === "string") {
      throw new Error("expected upstream server to have a port");
    }
    const upstreamUrl = `ws://127.0.0.1:${address.port}`;

    upstream.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "n1" } }));
      ws.on("message", (raw) => {
        const parsed = JSON.parse(String(raw ?? ""));
        if (parsed?.type !== "req" || typeof parsed.id !== "string") return;
        if (parsed.method === "connect") {
          ws.send(
            JSON.stringify({
              type: "res",
              id: parsed.id,
              ok: true,
              payload: { type: "hello-ok", protocol: 3 },
            })
          );
          return;
        }
        if (parsed.method === "status") {
          ws.send(
            JSON.stringify({
              type: "res",
              id: parsed.id,
              ok: true,
              payload: { ok: true, source: "upstream" },
            })
          );
        }
      });
    });

    const runtime = new ControlPlaneRuntime({
      dbPath: makeRuntimeDbPath(),
      adapterOptions: {
        loadSettings: () => ({ url: upstreamUrl, token: "upstream-token" }),
      },
    });

    await runtime.ensureStarted();
    const connectedSnapshot = runtime.snapshot();
    expect(connectedSnapshot.status).toBe("connected");

    const statusPayload = await runtime.callGateway<{ ok: boolean; source: string }>("status", {});
    expect(statusPayload).toEqual({ ok: true, source: "upstream" });

    await runtime.disconnect();
    const disconnectedSnapshot = runtime.snapshot();
    expect(disconnectedSnapshot.status).toBe("stopped");

    await closeWebSocketServer(upstream);
  });

  it("keeps a manual disconnect stopped until a forced restart", async () => {
    const upstream = new WebSocketServer({ port: 0 });
    const address = upstream.address();
    if (!address || typeof address === "string") {
      throw new Error("expected upstream server to have a port");
    }
    const upstreamUrl = `ws://127.0.0.1:${address.port}`;
    let connectionCount = 0;

    upstream.on("connection", (ws) => {
      connectionCount += 1;
      ws.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "n1" } }));
      ws.on("message", (raw) => {
        const parsed = JSON.parse(String(raw ?? ""));
        if (parsed?.method !== "connect") return;
        ws.send(
          JSON.stringify({
            type: "res",
            id: parsed.id,
            ok: true,
            payload: { type: "hello-ok", protocol: 3 },
          })
        );
      });
    });

    const runtime = new ControlPlaneRuntime({
      dbPath: makeRuntimeDbPath(),
      adapterOptions: {
        loadSettings: () => ({ url: upstreamUrl, token: "upstream-token" }),
      },
    });

    await runtime.ensureStarted();
    expect(connectionCount).toBe(1);

    await runtime.disconnect();
    expect(runtime.snapshot().status).toBe("stopped");
    fs.writeFileSync(
      path.join(tempDir!, "flatclaw-console", "settings.json"),
      JSON.stringify(
        {
          version: 1,
          gateway: { url: upstreamUrl, token: "upstream-token" },
          gatewayAutoStart: false,
          focused: {},
          avatars: {},
        },
        null,
        2
      ),
      "utf8"
    );

    await runtime.ensureStarted();
    expect(runtime.snapshot().status).toBe("stopped");
    expect(connectionCount).toBe(1);

    fs.writeFileSync(
      path.join(tempDir!, "flatclaw-console", "settings.json"),
      JSON.stringify(
        {
          version: 1,
          gateway: { url: upstreamUrl, token: "upstream-token" },
          gatewayAutoStart: true,
          focused: {},
          avatars: {},
        },
        null,
        2
      ),
      "utf8"
    );

    await runtime.ensureStarted({ force: true });
    expect(runtime.snapshot().status).toBe("connected");
    expect(connectionCount).toBe(2);

    await runtime.disconnect();
    await closeWebSocketServer(upstream);
  });

  it("enforces gateway method allowlist", async () => {
    const upstream = new WebSocketServer({ port: 0 });
    const address = upstream.address();
    if (!address || typeof address === "string") {
      throw new Error("expected upstream server to have a port");
    }
    const upstreamUrl = `ws://127.0.0.1:${address.port}`;

    upstream.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: {} }));
      ws.on("message", (raw) => {
        const parsed = JSON.parse(String(raw ?? ""));
        if (parsed?.method !== "connect") return;
        ws.send(
          JSON.stringify({
            type: "res",
            id: parsed.id,
            ok: true,
            payload: { type: "hello-ok", protocol: 3 },
          })
        );
      });
    });

    const runtime = new ControlPlaneRuntime({
      dbPath: makeRuntimeDbPath(),
      adapterOptions: {
        loadSettings: () => ({ url: upstreamUrl, token: "upstream-token" }),
      },
    });

    await runtime.ensureStarted();
    await expect(runtime.callGateway("sessions.delete", { key: "x" })).rejects.toThrow(
      "Gateway method is not allowlisted"
    );

    await runtime.disconnect();
    await closeWebSocketServer(upstream);
  });

  it("uses process-local singleton runtime", () => {
    const a = getControlPlaneRuntime();
    const b = getControlPlaneRuntime();
    expect(a).toBe(b);
  });

  it("always enables domain mode", () => {
    delete process.env.NEXT_PUBLIC_STUDIO_DOMAIN_API_MODE;
    process.env.STUDIO_DOMAIN_API_MODE = "true";
    expect(isStudioDomainApiModeEnabled()).toBe(true);
    process.env.STUDIO_DOMAIN_API_MODE = "1";
    expect(isStudioDomainApiModeEnabled()).toBe(true);
    process.env.STUDIO_DOMAIN_API_MODE = "false";
    expect(isStudioDomainApiModeEnabled()).toBe(true);
    delete process.env.STUDIO_DOMAIN_API_MODE;
    expect(isStudioDomainApiModeEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_STUDIO_DOMAIN_API_MODE = "false";
    expect(isStudioDomainApiModeEnabled()).toBe(true);
  });
});
