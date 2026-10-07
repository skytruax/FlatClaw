import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RELAYED_GATEWAY_EVENTS,
  eventSessionKey,
  isRelayedToAgent,
  sessionBelongsToAgent,
} from "./stream-events";

describe("event relay", () => {
  it("relays an agent's own session events", () => {
    for (const name of RELAYED_GATEWAY_EVENTS) {
      assert.equal(isRelayedToAgent(name, { sessionKey: "agent:ana:main" }, "ana"), true);
    }
    assert.equal(
      isRelayedToAgent("chat", { sessionKey: "agent:ana:subagent:1f2e" }, "ana"),
      true,
    );
  });

  it("drops another agent's events, even when the ids share a prefix", () => {
    assert.equal(isRelayedToAgent("chat", { sessionKey: "agent:bo:main" }, "ana"), false);
    assert.equal(
      isRelayedToAgent("chat", { sessionKey: "agent:ana-maria:main" }, "ana"),
      false,
    );
    assert.equal(sessionBelongsToAgent("agent:ana-maria:main", "ana"), false);
  });

  it("drops an event that names no session", () => {
    assert.equal(isRelayedToAgent("sessions.changed", { reason: "create" }, "ana"), false);
    assert.equal(isRelayedToAgent("chat", null, "ana"), false);
    assert.equal(isRelayedToAgent("chat", { sessionKey: 7 }, "ana"), false);
    assert.equal(eventSessionKey({ sessionKey: "" }), null);
  });

  it("drops gateway-wide events whatever they carry", () => {
    for (const name of [
      "exec.approval.requested",
      "plugin.approval.requested",
      "device.pair.requested",
      "presence",
      "cron",
      "health",
    ]) {
      assert.equal(isRelayedToAgent(name, { sessionKey: "agent:ana:main" }, "ana"), false);
    }
  });

  it("matches nothing for an empty agent id", () => {
    assert.equal(isRelayedToAgent("chat", { sessionKey: "agent::main" }, ""), false);
  });
});
