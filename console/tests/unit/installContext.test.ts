import { describe, expect, it } from "vitest";

import {
  defaultStudioInstallContext,
  resolveDefaultSetupScenario,
  resolveGatewayConnectionWarnings,
} from "@/lib/studio/install-context";

describe("studio install context helpers", () => {
  it("defaults to same-cloud-host when Studio looks remote and the upstream is localhost", () => {
    const installContext = defaultStudioInstallContext();
    installContext.studioHost.remoteShell = true;

    const scenario = resolveDefaultSetupScenario({
      installContext,
      gatewayUrl: "ws://localhost:18789",
    });

    expect(scenario).toBe("same-cloud-host");
  });

  it("defaults to remote-gateway when the upstream is remote", () => {
    const scenario = resolveDefaultSetupScenario({
      installContext: defaultStudioInstallContext(),
      gatewayUrl: "wss://gateway.example.ts.net",
    });

    expect(scenario).toBe("remote-gateway");
  });

  it("warns when a tailscale hostname uses ws without TLS", () => {
    const warnings = resolveGatewayConnectionWarnings({
      gatewayUrl: "ws://gateway-host.ts.net",
      installContext: defaultStudioInstallContext(),
      scenario: "remote-gateway",
      hasStoredToken: false,
      hasLocalGatewayToken: false,
    });

    expect(warnings.map((warning) => warning.id)).toContain("tailscale-ws");
    expect(warnings.map((warning) => warning.id)).toContain("remote-ws-control-ui-auth");
    expect(warnings.map((warning) => warning.id)).toContain("tailscale-still-needs-token");
  });

  it("warns when a remote setup uses a raw private IP websocket", () => {
    const warnings = resolveGatewayConnectionWarnings({
      gatewayUrl: "ws://100.99.1.5:18789",
      installContext: defaultStudioInstallContext(),
      scenario: "remote-gateway",
      hasStoredToken: true,
      hasLocalGatewayToken: false,
    });

    expect(warnings.map((warning) => warning.id)).toContain("private-ip-advanced");
  });

  it("explains localhost when Studio is running on a remote host", () => {
    const installContext = defaultStudioInstallContext();
    installContext.studioHost.remoteShell = true;

    const warnings = resolveGatewayConnectionWarnings({
      gatewayUrl: "ws://localhost:18789",
      installContext,
      scenario: "same-cloud-host",
      hasStoredToken: true,
      hasLocalGatewayToken: false,
    });

    expect(warnings.map((warning) => warning.id)).toContain("remote-localhost");
  });
});
