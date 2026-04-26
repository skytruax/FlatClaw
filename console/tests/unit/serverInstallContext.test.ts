import { describe, expect, it } from "vitest";

describe("server install context detector", () => {
  it("detects a remote shell with local OpenClaw defaults and tailscale", async () => {
    const { detectInstallContext } = await import("../../server/install-context");

    const runCommand = async (file: string, args: string[]) => {
      if (file === "openclaw" && args[0] === "status") {
        return { stdout: JSON.stringify({ runtime: "running" }) };
      }
      if (file === "openclaw" && args[0] === "sessions") {
        return { stdout: JSON.stringify({ sessions: [] }) };
      }
      if (file === "tailscale") {
        return {
          stdout: JSON.stringify({
            BackendState: "Running",
            Self: { DNSName: "studio-host.tailnet.ts.net." },
          }),
        };
      }
      throw Object.assign(new Error("unexpected command"), { code: "ENOENT" });
    };

    const context = await detectInstallContext(
      {
        NODE_ENV: "test",
        SSH_CONNECTION: "1 2 3 4",
        STUDIO_ACCESS_TOKEN: "studio-secret",
      },
      {
        resolveHosts: () => ["127.0.0.1"],
        isPublicHost: () => false,
        readOpenclawGatewayDefaults: () => ({
          url: "ws://localhost:18789",
          token: "local-token",
        }),
        runCommand,
      }
    );

    expect(context.studioHost.remoteShell).toBe(true);
    expect(context.studioHost.loopbackOnly).toBe(true);
    expect(context.studioHost.studioAccessTokenConfigured).toBe(true);
    expect(context.localGateway.defaultsDetected).toBe(true);
    expect(context.localGateway.hasToken).toBe(true);
    expect(context.localGateway.probeHealthy).toBe(true);
    expect(context.studioCli.installed).toBe(false);
    expect(context.studioCli.updateAvailable).toBe(false);
    expect(context.tailscale.loggedIn).toBe(true);
    expect(context.tailscale.dnsName).toBe("studio-host.tailnet.ts.net");
  });

  it("falls back cleanly when openclaw and tailscale are missing", async () => {
    const { detectInstallContext } = await import("../../server/install-context");

    const runCommand = async () => {
      throw Object.assign(new Error("not found"), { code: "ENOENT" });
    };

    const context = await detectInstallContext(
      {
        NODE_ENV: "test",
      },
      {
        resolveHosts: () => ["127.0.0.1"],
        isPublicHost: () => false,
        readOpenclawGatewayDefaults: () => null,
        runCommand,
      }
    );

    expect(context.localGateway.defaultsDetected).toBe(false);
    expect(context.localGateway.cliAvailable).toBe(false);
    expect(context.localGateway.probeHealthy).toBe(false);
    expect(context.localGateway.issues).toContain("cli_not_found");
    expect(context.studioCli.installed).toBe(false);
    expect(context.studioCli.updateAvailable).toBe(false);
    expect(context.tailscale.installed).toBe(false);
    expect(context.tailscale.loggedIn).toBe(false);
  });

  it("uses a placeholder ssh target when no reachable host is known", async () => {
    const { buildStartupGuidance } = await import("../../server/install-context");

    const lines = buildStartupGuidance({
      port: 3000,
      installContext: {
        studioHost: {
          hostname: "ip-10-0-1-35",
          configuredHosts: ["127.0.0.1"],
          publicHosts: [],
          loopbackOnly: true,
          remoteShell: true,
          studioAccessTokenConfigured: false,
        },
        localGateway: {
          defaultsDetected: true,
          url: "ws://localhost:18789",
          hasToken: true,
          cliAvailable: true,
          statusProbeOk: true,
          sessionsProbeOk: true,
          probeHealthy: true,
          issues: [],
        },
        studioCli: {
          installed: false,
          currentVersion: null,
          latestVersion: null,
          updateAvailable: false,
          checkedAt: null,
          checkError: null,
        },
        tailscale: {
          installed: false,
          loggedIn: false,
          dnsName: null,
        },
      },
    });

    expect(lines).toContain("SSH tunnel fallback: ssh -L 3000:127.0.0.1:3000 <studio-host>");
  });
});
