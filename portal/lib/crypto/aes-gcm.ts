import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

function key(): Buffer {
  const hex = process.env.PORTAL_SECRETS_KEY;
  if (!hex) {
    throw new Error(
      "PORTAL_SECRETS_KEY env var is required (32-byte hex string)",
    );
  }
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error("PORTAL_SECRETS_KEY must be 32 bytes (64 hex chars)");
  }
  return buf;
}

export interface SealedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encrypt(plaintext: string, aad?: string): SealedSecret {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key(), iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decrypt(sealed: SealedSecret, aad?: string): string {
  const iv = Buffer.from(sealed.iv, "base64");
  const authTag = Buffer.from(sealed.authTag, "base64");
  const ciphertext = Buffer.from(sealed.ciphertext, "base64");
  const decipher = createDecipheriv(ALGO, key(), iv);
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}
