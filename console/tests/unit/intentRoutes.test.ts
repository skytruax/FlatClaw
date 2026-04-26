// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

describe("intent routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("chat-send route forwards to gateway intent runtime", async () => {
    const callGateway = vi.fn(async () => ({ runId: "run-1", status: "started" }));
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => ({
        ensureStarted: async () => {},
        callGateway,
      }),
    }));
    const mod = await import("@/app/api/intents/chat-send/route");

    const response = await mod.POST(
      new Request("http://localhost/api/intents/chat-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionKey: "agent:agent-1:main",
          message: "hello",
          idempotencyKey: "run-1",
          deliver: false,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(callGateway).toHaveBeenCalledWith("chat.send", {
      sessionKey: "agent:agent-1:main",
      message: "hello",
      idempotencyKey: "run-1",
      deliver: false,
    });
  });

  it("sessions-reset, session-settings-sync, and agent-wait routes forward expected payloads", async () => {
    const callGateway = vi.fn(async () => ({ ok: true }));
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => ({
        ensureStarted: async () => {},
        callGateway,
      }),
    }));
    const { LONG_RUNNING_GATEWAY_INTENT_TIMEOUT_MS } = await import("@/lib/controlplane/intent-route");
    const resetRoute = await import("@/app/api/intents/sessions-reset/route");
    const sessionSettingsRoute = await import("@/app/api/intents/session-settings-sync/route");
    const waitRoute = await import("@/app/api/intents/agent-wait/route");
    const cronRunRoute = await import("@/app/api/intents/cron-run/route");

    const resetResponse = await resetRoute.POST(
      new Request("http://localhost/api/intents/sessions-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "agent:agent-1:main" }),
      })
    );
    const sessionSettingsResponse = await sessionSettingsRoute.POST(
      new Request("http://localhost/api/intents/session-settings-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionKey: "agent:agent-1:main",
          model: "openai/gpt-5",
        }),
      })
    );
    const waitResponse = await waitRoute.POST(
      new Request("http://localhost/api/intents/agent-wait", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: "run-1", timeoutMs: 3000 }),
      })
    );
    const cronRunResponse = await cronRunRoute.POST(
      new Request("http://localhost/api/intents/cron-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "job-1" }),
      })
    );

    expect(resetResponse.status).toBe(200);
    expect(sessionSettingsResponse.status).toBe(200);
    expect(waitResponse.status).toBe(200);
    expect(cronRunResponse.status).toBe(200);
    expect(callGateway).toHaveBeenCalledWith("sessions.reset", { key: "agent:agent-1:main" });
    expect(callGateway).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:agent-1:main",
      model: "openai/gpt-5",
    });
    expect(callGateway).toHaveBeenCalledWith(
      "agent.wait",
      { runId: "run-1", timeoutMs: 3000 },
      { timeoutMs: 3000 }
    );
    expect(callGateway).toHaveBeenCalledWith(
      "cron.run",
      { id: "job-1", mode: "force" },
      { timeoutMs: LONG_RUNNING_GATEWAY_INTENT_TIMEOUT_MS }
    );
  });

  it("agent-create route composes workspace from config path and forwards to agents.create", async () => {
    const callGateway = vi.fn(async (method: string) => {
      if (method === "config.get") {
        return {
          path: "/tmp/.openclaw/openclaw.json",
        };
      }
      if (method === "agents.create") {
        return {
          ok: true,
          agentId: "agent-two",
          name: "Agent Two",
          workspace: "/tmp/.openclaw/workspace-agent-two",
        };
      }
      return { ok: true };
    });
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => ({
        ensureStarted: async () => {},
        callGateway,
      }),
    }));
    const mod = await import("@/app/api/intents/agent-create/route");

    const response = await mod.POST(
      new Request("http://localhost/api/intents/agent-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Agent Two" }),
      })
    );
    expect(response.status).toBe(200);
    expect(callGateway).toHaveBeenCalledWith("agents.create", {
      name: "Agent Two",
      workspace: "/tmp/.openclaw/workspace-agent-two",
    });
  });

  it("agent-permissions-update route performs config/session updates server-side", async () => {
    const upsert = vi.fn(async () => undefined);
    const callGateway = vi.fn(async (method: string) => {
      if (method === "config.get") {
        return {
          hash: "cfg-hash-1",
          exists: true,
          config: {
            agents: {
              list: [
                {
                  id: "agent-1",
                  sandbox: { mode: "normal" },
                  tools: { alsoAllow: ["group:web"], deny: ["group:fs"] },
                },
              ],
            },
          },
        };
      }
      return { ok: true };
    });
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => ({
        ensureStarted: async () => {},
        callGateway,
      }),
    }));
    vi.doMock("@/lib/controlplane/exec-approvals", async () => {
      const actual = await vi.importActual<typeof import("@/lib/controlplane/exec-approvals")>(
        "@/lib/controlplane/exec-approvals"
      );
      return {
        ...actual,
        upsertAgentExecApprovalsPolicyViaRuntime: upsert,
      };
    });

    const mod = await import("@/app/api/intents/agent-permissions-update/route");
    const response = await mod.POST(
      new Request("http://localhost/api/intents/agent-permissions-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "agent-1",
          sessionKey: "agent:agent-1:main",
          commandMode: "ask",
          webAccess: true,
          fileTools: true,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1", role: "collaborative" })
    );
    expect(callGateway).toHaveBeenCalledWith(
      "config.set",
      expect.objectContaining({ baseHash: "cfg-hash-1" })
    );
    expect(callGateway).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:agent-1:main",
      execHost: "gateway",
      execSecurity: "allowlist",
      execAsk: "always",
    });
  });

  it("agent-permissions-update returns conflict without mutating approvals", async () => {
    const upsert = vi.fn(async () => undefined);
    const { ControlPlaneGatewayError } = await import("@/lib/controlplane/openclaw-adapter");
    const callGateway = vi.fn(async (method: string) => {
      if (method === "config.get") {
        return {
          hash: "cfg-hash-1",
          exists: true,
          config: {
            agents: {
              list: [
                {
                  id: "agent-1",
                  sandbox: { mode: "normal" },
                  tools: { alsoAllow: ["group:web"], deny: ["group:fs"] },
                },
              ],
            },
          },
        };
      }
      if (method === "config.set") {
        throw new ControlPlaneGatewayError({
          code: "INVALID_REQUEST",
          message: "config baseHash changed since last load; re-run config.get",
        });
      }
      return { ok: true };
    });
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => ({
        ensureStarted: async () => {},
        callGateway,
      }),
    }));
    vi.doMock("@/lib/controlplane/exec-approvals", async () => {
      const actual = await vi.importActual<typeof import("@/lib/controlplane/exec-approvals")>(
        "@/lib/controlplane/exec-approvals"
      );
      return {
        ...actual,
        upsertAgentExecApprovalsPolicyViaRuntime: upsert,
      };
    });

    const mod = await import("@/app/api/intents/agent-permissions-update/route");
    const response = await mod.POST(
      new Request("http://localhost/api/intents/agent-permissions-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "agent-1",
          sessionKey: "agent:agent-1:main",
          commandMode: "ask",
          webAccess: true,
          fileTools: true,
        }),
      })
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { code?: string; conflict?: string };
    expect(body.code).toBe("INVALID_REQUEST");
    expect(body.conflict).toBe("base_hash_mismatch");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("chat-send returns deterministic gateway_unavailable response when runtime cannot start", async () => {
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => ({
        ensureStarted: async () => {
          throw new Error("gateway unavailable");
        },
        callGateway: vi.fn(),
      }),
    }));
    const mod = await import("@/app/api/intents/chat-send/route");

    const response = await mod.POST(
      new Request("http://localhost/api/intents/chat-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionKey: "agent:agent-1:main",
          message: "hello",
          idempotencyKey: "run-1",
          deliver: false,
        }),
      })
    );

    expect(response.status).toBe(503);
    const body = await response.json() as { code?: string; reason?: string };
    expect(body.code).toBe("GATEWAY_UNAVAILABLE");
    expect(body.reason).toBe("gateway_unavailable");
  });

  it("chat-send returns native mismatch remediation when runtime init fails", async () => {
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => {
        const error = new Error(
          "The module '/tmp/better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 141."
        ) as Error & { code: string };
        error.code = "ERR_DLOPEN_FAILED";
        throw error;
      },
    }));
    const mod = await import("@/app/api/intents/chat-send/route");

    const response = await mod.POST(
      new Request("http://localhost/api/intents/chat-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionKey: "agent:agent-1:main",
          message: "hello",
          idempotencyKey: "run-1",
          deliver: false,
        }),
      })
    );

    expect(response.status).toBe(503);
    const body = await response.json() as {
      code?: string;
      reason?: string;
      remediation?: { commands?: string[] };
    };
    expect(body.code).toBe("NATIVE_MODULE_MISMATCH");
    expect(body.reason).toBe("native_module_mismatch");
    expect(body.remediation?.commands).toEqual([
      "npm rebuild better-sqlite3",
      "npm install",
    ]);
  });

  it("chat-send returns 404 when domain mode is disabled", async () => {
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => false,
      getControlPlaneRuntime: vi.fn(),
    }));
    const mod = await import("@/app/api/intents/chat-send/route");

    const response = await mod.POST(
      new Request("http://localhost/api/intents/chat-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionKey: "agent:agent-1:main",
          message: "hello",
          idempotencyKey: "run-1",
          deliver: false,
        }),
      })
    );

    expect(response.status).toBe(404);
    const body = await response.json() as { error?: string };
    expect(body.error).toBe("domain_api_mode_disabled");
  });

  it("cron-remove-agent and cron-restore routes use server gateway runtime methods", async () => {
    const callGateway = vi.fn(async (method: string) => {
      if (method === "cron.list") {
        return {
          jobs: [
            {
              id: "job-1",
              name: "Job One",
              agentId: "agent-1",
              enabled: true,
              schedule: { kind: "every", everyMs: 60_000 },
              sessionTarget: "isolated",
              wakeMode: "now",
              payload: { kind: "agentTurn", message: "Do work" },
            },
            {
              id: "job-2",
              name: "Job Two",
              agentId: "agent-2",
              enabled: true,
              schedule: { kind: "every", everyMs: 120_000 },
              sessionTarget: "isolated",
              wakeMode: "now",
              payload: { kind: "agentTurn", message: "Other" },
            },
          ],
        };
      }
      if (method === "cron.remove") {
        return { ok: true, removed: true };
      }
      if (method === "cron.add") {
        return { ok: true };
      }
      return { ok: true };
    });
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => ({
        ensureStarted: async () => {},
        callGateway,
      }),
    }));
    const removeRoute = await import("@/app/api/intents/cron-remove-agent/route");
    const restoreRoute = await import("@/app/api/intents/cron-restore/route");

    const removeResponse = await removeRoute.POST(
      new Request("http://localhost/api/intents/cron-remove-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1" }),
      })
    );
    const restoreResponse = await restoreRoute.POST(
      new Request("http://localhost/api/intents/cron-restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobs: [
            {
              name: "Job One",
              agentId: "agent-1",
              enabled: true,
              schedule: { kind: "every", everyMs: 60_000 },
              sessionTarget: "isolated",
              wakeMode: "now",
              payload: { kind: "agentTurn", message: "Do work" },
            },
          ],
        }),
      })
    );

    expect(removeResponse.status).toBe(200);
    expect(restoreResponse.status).toBe(200);
    expect(callGateway).toHaveBeenCalledWith("cron.list", { includeDisabled: true });
    expect(callGateway).toHaveBeenCalledWith("cron.remove", { id: "job-1" });
    expect(callGateway).toHaveBeenCalledWith(
      "cron.add",
      expect.objectContaining({ name: "Job One", agentId: "agent-1" })
    );
    expect(callGateway).not.toHaveBeenCalledWith("cron.remove", { id: "job-2" });
  });

  it("cron-remove-agent returns gateway_unavailable when runtime gateway is unavailable", async () => {
    const { ControlPlaneGatewayError } = await import("@/lib/controlplane/openclaw-adapter");
    const callGateway = vi.fn(async () => {
      throw new ControlPlaneGatewayError({
        code: "GATEWAY_UNAVAILABLE",
        message: "Gateway is unavailable.",
      });
    });
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => ({
        ensureStarted: async () => {},
        callGateway,
      }),
    }));
    const removeRoute = await import("@/app/api/intents/cron-remove-agent/route");

    const response = await removeRoute.POST(
      new Request("http://localhost/api/intents/cron-remove-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1" }),
      })
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as { code?: string; reason?: string };
    expect(body.code).toBe("GATEWAY_UNAVAILABLE");
    expect(body.reason).toBe("gateway_unavailable");
  });
});
