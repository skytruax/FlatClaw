import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDeviceAuthPayload,
  loadOrCreateDeviceIdentity,
  signConnectChallenge,
} from "./device-identity";

const scratch = () => join(mkdtempSync(join(tmpdir(), "fc-device-")), "nested", "gateway-device.json");

describe("gateway device identity", () => {
  it("creates an Ed25519 identity whose id is the sha256 of the raw public key", () => {
    const identity = loadOrCreateDeviceIdentity(scratch());
    const raw = Buffer.from(identity.publicKey, "base64url");
    assert.equal(raw.length, 32);
    assert.equal(identity.deviceId, crypto.createHash("sha256").update(raw).digest("hex"));
    assert.match(identity.privateKeyPem, /BEGIN PRIVATE KEY/);
  });

  it("persists the identity owner-only and returns the same one next time", () => {
    const path = scratch();
    const first = loadOrCreateDeviceIdentity(path);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(loadOrCreateDeviceIdentity(path), first);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).deviceId, first.deviceId);
  });

  it("refuses a malformed identity file instead of silently minting another", () => {
    const path = scratch();
    loadOrCreateDeviceIdentity(path);
    writeFileSync(path, JSON.stringify({ deviceId: "x" }));
    assert.throws(() => loadOrCreateDeviceIdentity(path), /malformed/);
  });

  it("builds the v3 payload exactly as the gateway rebuilds it", () => {
    const payload = buildDeviceAuthPayload("dev-1", {
      clientId: "gateway-client",
      clientMode: "backend",
      role: "operator",
      scopes: ["operator.admin", "operator.read"],
      token: "tok",
      nonce: "n-1",
      platform: "Linux",
      signedAtMs: 1700000000000,
    });
    assert.equal(
      payload,
      "v3|dev-1|gateway-client|backend|operator|operator.admin,operator.read|1700000000000|tok|n-1|linux|",
    );
  });

  it("signs the challenge so the gateway's verification passes", () => {
    const identity = loadOrCreateDeviceIdentity(scratch());
    const params = {
      clientId: "gateway-client",
      clientMode: "backend",
      role: "operator",
      scopes: ["operator.admin"],
      token: "shared-token",
      nonce: "nonce-from-challenge",
      platform: "linux",
      signedAtMs: 1700000000000,
    };
    const block = signConnectChallenge(identity, params);
    assert.deepEqual(
      { id: block.id, publicKey: block.publicKey, signedAt: block.signedAt, nonce: block.nonce },
      { id: identity.deviceId, publicKey: identity.publicKey, signedAt: 1700000000000, nonce: "nonce-from-challenge" },
    );
    // Verify the way the gateway does: raw public key → SPKI, Ed25519 over the payload.
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([spkiPrefix, Buffer.from(block.publicKey, "base64url")]),
      format: "der",
      type: "spki",
    });
    const payload = buildDeviceAuthPayload(identity.deviceId, params);
    assert.ok(crypto.verify(null, Buffer.from(payload, "utf8"), publicKey, Buffer.from(block.signature, "base64url")));
    // …and a different nonce must not verify with the same signature.
    const other = buildDeviceAuthPayload(identity.deviceId, { ...params, nonce: "other" });
    assert.equal(crypto.verify(null, Buffer.from(other, "utf8"), publicKey, Buffer.from(block.signature, "base64url")), false);
  });
});
