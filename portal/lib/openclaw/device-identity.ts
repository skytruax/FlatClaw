import crypto from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The portal's device identity for the OpenClaw gateway.
 *
 * Up to openclaw 2026.7 the portal connected as the Control UI with only the
 * shared gateway token, relying on
 * `gateway.controlUi.dangerouslyDisableDeviceAuth = true`. That bypass was
 * retired in 2026.8: a token-only Control UI client is now rejected with
 * "control ui requires device identity", and a client that merely claims the
 * Control UI id is rejected again by the Control UI build check. The portal
 * therefore connects as what it is — a backend client — and proves a stable
 * device identity the documented way:
 *
 *   - an Ed25519 key pair, persisted next to the portal database
 *   - device id = sha256(raw 32-byte public key), hex
 *   - on connect, sign the gateway's `connect.challenge` nonce together with
 *     the client id/mode, role, scopes and the shared token
 *
 * The payload format is byte-for-byte what the gateway rebuilds and verifies
 * (openclaw/packages/gateway-client/src/device-auth.ts, `buildDeviceAuthPayloadV3`;
 * server side: src/gateway/server/ws-connection/handshake-auth-helpers.ts).
 *
 * Pairing: a shared-token connection over loopback is approved silently
 * (`gateway.nodes.pairing.autoApproveLocal`, default true), which is the
 * FlatClaw topology — portal and gateway share a host/container. If the two
 * are ever split across hosts, the first connect needs a one-time
 * `openclaw devices approve <requestId>` on the gateway.
 */

export interface DeviceIdentity {
  /** sha256 of the raw public key, hex. */
  deviceId: string;
  /** Raw 32-byte Ed25519 public key, base64url. */
  publicKey: string;
  /** PKCS#8 PEM private key. */
  privateKeyPem: string;
}

/** The signed block sent as `connect.params.device`. */
export interface DeviceConnectBlock {
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce: string;
}

export interface DeviceSignParams {
  clientId: string;
  clientMode: string;
  role: string;
  scopes: readonly string[];
  /** The shared gateway token sent in `auth.token` (empty string if none). */
  token: string;
  /** Nonce from the gateway's `connect.challenge` event. */
  nonce: string;
  platform?: string;
  deviceFamily?: string;
  /** Injectable clock for tests. */
  signedAtMs?: number;
}

/**
 * Where the identity lives. Next to the portal DB so it sits on the same
 * persistent volume (in the control image: /data/.openclaw-portal/) — a fresh
 * key on every boot would register a new paired device each time.
 */
export function deviceIdentityPath(): string {
  if (process.env.PORTAL_GATEWAY_DEVICE_KEY) {
    return process.env.PORTAL_GATEWAY_DEVICE_KEY;
  }
  const dbPath =
    process.env.PORTAL_DB_PATH ?? join(homedir(), ".openclaw-portal", "portal.db");
  return join(dirname(dbPath), "gateway-device.json");
}

function generateDeviceIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  // The SPKI DER encoding of an Ed25519 key ends with the raw 32-byte key.
  const spki = publicKey.export({ type: "spki", format: "der" });
  const raw = spki.subarray(spki.length - 32);
  return {
    deviceId: crypto.createHash("sha256").update(raw).digest("hex"),
    publicKey: raw.toString("base64url"),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function parseDeviceIdentity(text: string, path: string): DeviceIdentity {
  const parsed = JSON.parse(text) as Partial<DeviceIdentity>;
  if (
    typeof parsed.deviceId !== "string" ||
    typeof parsed.publicKey !== "string" ||
    typeof parsed.privateKeyPem !== "string"
  ) {
    throw new Error(
      `gateway device identity at ${path} is malformed — move it aside to mint a new one (the gateway will pair the new device on the next connect)`,
    );
  }
  return {
    deviceId: parsed.deviceId,
    publicKey: parsed.publicKey,
    privateKeyPem: parsed.privateKeyPem,
  };
}

/**
 * Load the persisted identity, creating it on first use. Creation is an
 * exclusive write so two processes racing on a fresh install converge on one
 * key instead of each keeping its own.
 */
export function loadOrCreateDeviceIdentity(
  path: string = deviceIdentityPath(),
): DeviceIdentity {
  try {
    return parseDeviceIdentity(readFileSync(path, "utf8"), path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const identity = generateDeviceIdentity();
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, JSON.stringify(identity, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    return identity;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    // Lost the race — the other writer's key is the identity.
    return parseDeviceIdentity(readFileSync(path, "utf8"), path);
  }
}

/** Lower-cases ASCII only, exactly like the gateway's normalizer. */
function normalizeDeviceMetadata(value: string | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/** The exact string the gateway rebuilds and verifies the signature against. */
export function buildDeviceAuthPayload(
  deviceId: string,
  p: DeviceSignParams & { signedAtMs: number },
): string {
  return [
    "v3",
    deviceId,
    p.clientId,
    p.clientMode,
    p.role,
    p.scopes.join(","),
    String(p.signedAtMs),
    p.token,
    p.nonce,
    normalizeDeviceMetadata(p.platform),
    normalizeDeviceMetadata(p.deviceFamily),
  ].join("|");
}

/** Build the signed `device` block for a connect frame. */
export function signConnectChallenge(
  identity: DeviceIdentity,
  params: DeviceSignParams,
): DeviceConnectBlock {
  const signedAtMs = params.signedAtMs ?? Date.now();
  const payload = buildDeviceAuthPayload(identity.deviceId, {
    ...params,
    signedAtMs,
  });
  const signature = crypto
    .sign(null, Buffer.from(payload, "utf8"), crypto.createPrivateKey(identity.privateKeyPem))
    .toString("base64url");
  return {
    id: identity.deviceId,
    publicKey: identity.publicKey,
    signature,
    signedAt: signedAtMs,
    nonce: params.nonce,
  };
}
