import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Compact stateless OAuth state token. Encodes a small JSON payload + HMAC
 * signature so the callback can verify it came from us without storing
 * pending state server-side.
 *
 * Format: base64url(payload) + "." + base64url(sig)
 */

const SECRET_ENV = "AUTH_SECRET";
const TTL_MS = 10 * 60 * 1000;

interface OAuthStatePayload {
  userId: string;
  /** Service plugin id (e.g. "google", "slack"). Pins state to one provider so
   * a state minted for one service can't be replayed against another. */
  service: string;
  nonce: string;
  exp: number; // unix ms
}

function key(): Buffer {
  const v = process.env[SECRET_ENV];
  if (!v)
    throw new Error(`${SECRET_ENV} env var required to sign OAuth state`);
  return Buffer.from(v, "utf8");
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function signOAuthState(userId: string, service: string): string {
  const payload: OAuthStatePayload = {
    userId,
    service,
    nonce: randomBytes(16).toString("hex"),
    exp: Date.now() + TTL_MS,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", key()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyOAuthState(state: string): OAuthStatePayload {
  const dot = state.indexOf(".");
  if (dot < 0) throw new Error("invalid state");
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = createHmac("sha256", key()).update(body).digest();
  const provided = fromB64url(sig);
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    throw new Error("invalid state signature");
  }
  const payload = JSON.parse(fromB64url(body).toString("utf8")) as OAuthStatePayload;
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) {
    throw new Error("oauth state expired");
  }
  if (typeof payload.userId !== "string" || !payload.userId) {
    throw new Error("oauth state missing userId");
  }
  if (typeof payload.service !== "string" || !payload.service) {
    throw new Error("oauth state missing service");
  }
  return payload;
}
