import { describe, expect, it } from "vitest";

import {
  resolveSessionExecSettingsForRole,
  resolveToolGroupOverrides,
} from "@/features/agents/operations/agentPermissionsOperation";

describe("permissions role helpers", () => {
  it("updates tool overrides using allow when existing tools.allow is present", () => {
    const existingTools = { allow: ["group:web"], deny: ["group:runtime"] };

    const collaborative = resolveToolGroupOverrides({
      existingTools,
      runtimeEnabled: true,
      webEnabled: true,
      fsEnabled: false,
    });
    expect(collaborative.tools.allow).toEqual(expect.arrayContaining(["group:web", "group:runtime"]));
    expect(collaborative.tools).not.toHaveProperty("alsoAllow");
    expect(collaborative.tools.deny).not.toEqual(expect.arrayContaining(["group:runtime"]));

    const conservative = resolveToolGroupOverrides({
      existingTools,
      runtimeEnabled: false,
      webEnabled: true,
      fsEnabled: false,
    });
    expect(conservative.tools.allow).toEqual(expect.arrayContaining(["group:web"]));
    expect(conservative.tools.allow).not.toEqual(expect.arrayContaining(["group:runtime"]));
    expect(conservative.tools.deny).toEqual(expect.arrayContaining(["group:runtime"]));
  });

  it("updates tool overrides using alsoAllow when tools.allow is absent", () => {
    const existingTools = { alsoAllow: ["group:web"], deny: [] as string[] };

    const collaborative = resolveToolGroupOverrides({
      existingTools,
      runtimeEnabled: true,
      webEnabled: true,
      fsEnabled: false,
    });
    expect(collaborative.tools.alsoAllow).toEqual(expect.arrayContaining(["group:web", "group:runtime"]));
    expect(collaborative.tools).not.toHaveProperty("allow");

    const conservative = resolveToolGroupOverrides({
      existingTools,
      runtimeEnabled: false,
      webEnabled: true,
      fsEnabled: false,
    });
    expect(conservative.tools.alsoAllow).toEqual(expect.arrayContaining(["group:web"]));
    expect(conservative.tools.alsoAllow).not.toEqual(expect.arrayContaining(["group:runtime"]));
    expect(conservative.tools.deny).toEqual(expect.arrayContaining(["group:runtime"]));
  });

  it("resolves session exec settings from role and sandbox mode", () => {
    expect(resolveSessionExecSettingsForRole({ role: "conservative", sandboxMode: "all" })).toEqual({
      execHost: null,
      execSecurity: "deny",
      execAsk: "off",
    });

    expect(resolveSessionExecSettingsForRole({ role: "collaborative", sandboxMode: "all" }).execHost).toBe(
      "sandbox"
    );
    expect(resolveSessionExecSettingsForRole({ role: "autonomous", sandboxMode: "all" }).execHost).toBe(
      "sandbox"
    );

    expect(resolveSessionExecSettingsForRole({ role: "collaborative", sandboxMode: "none" }).execHost).toBe(
      "gateway"
    );
    expect(resolveSessionExecSettingsForRole({ role: "autonomous", sandboxMode: "none" }).execHost).toBe(
      "gateway"
    );
  });

  it("treats missing tools config as empty lists and still enforces group:runtime semantics", () => {
    const collaborative = resolveToolGroupOverrides({
      existingTools: null,
      runtimeEnabled: true,
      webEnabled: false,
      fsEnabled: false,
    });
    expect(collaborative.tools.alsoAllow).toEqual(expect.arrayContaining(["group:runtime"]));
    expect(collaborative.tools).not.toHaveProperty("allow");
  });
});
