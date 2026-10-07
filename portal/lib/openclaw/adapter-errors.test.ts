import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isGatewayRestartingError } from "./adapter";

describe("gateway restarting errors", () => {
  it("recognises the gateway saying it is starting or restarting", () => {
    for (const message of [
      "UNAVAILABLE: gateway starting; retry shortly",
      "UNAVAILABLE: tools.catalog unavailable during gateway restart",
      "UNAVAILABLE: gateway is restarting",
    ]) {
      assert.equal(isGatewayRestartingError(new Error(message)), true, message);
    }
  });

  it("leaves every other gateway error alone", () => {
    for (const message of [
      "INVALID_REQUEST: config changed since last load; re-run config.get and retry",
      'INVALID_REQUEST: agent "ana" not found',
      "UNAVAILABLE: model provider unavailable",
      "gateway timeout: models.list (20000ms)",
      "model not allowed: flatclaw-probe/stand-in",
    ]) {
      assert.equal(isGatewayRestartingError(new Error(message)), false, message);
    }
    assert.equal(isGatewayRestartingError("UNAVAILABLE: gateway starting; retry shortly"), false);
  });
});
