import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/crypto/aes-gcm";

/**
 * cPanel credential vault.
 *
 * Per-user, AES-256-GCM-encrypted cPanel API token storage. The plaintext
 * payload is just the API token; username/serverUrl/verifySsl are stored
 * as plain columns since they're configuration metadata, not secrets.
 *
 * The AAD pins each ciphertext to "cpanel:<userId>" — so a copy-paste of one
 * user's row to another user's slot would fail GCM verification.
 *
 * Refresh-token equivalent doesn't exist for cPanel (API tokens are long-lived
 * until manually revoked in WHM), so the bridge endpoint just decrypts and
 * returns. Rotation = admin pastes a new token; we overwrite the row.
 */

const AAD_PREFIX = "cpanel-credential";

export interface CpanelCredentialPayload {
  username: string;
  apiToken: string;
  serverUrl: string;
  verifySsl: boolean;
}

export interface CpanelCredentialStatus {
  connected: boolean;
  username: string | null;
  serverUrl: string | null;
  verifySsl: boolean;
  updatedAt: Date | null;
  lastUsedAt: Date | null;
}

function aadFor(userId: string): string {
  return `${AAD_PREFIX}:${userId}`;
}

export async function setCpanelCredential(
  userId: string,
  payload: CpanelCredentialPayload,
): Promise<void> {
  const sealed = encrypt(payload.apiToken, aadFor(userId));
  const now = new Date();

  const existing = await db
    .select()
    .from(schema.cpanelCredentials)
    .where(eq(schema.cpanelCredentials.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.cpanelCredentials)
      .set({
        username: payload.username,
        serverUrl: payload.serverUrl,
        verifySsl: payload.verifySsl,
        apiTokenCipher: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        updatedAt: now,
      })
      .where(eq(schema.cpanelCredentials.id, existing[0].id));
    return;
  }

  await db.insert(schema.cpanelCredentials).values({
    id: randomUUID(),
    userId,
    username: payload.username,
    serverUrl: payload.serverUrl,
    verifySsl: payload.verifySsl,
    apiTokenCipher: sealed.ciphertext,
    iv: sealed.iv,
    authTag: sealed.authTag,
    createdAt: now,
    updatedAt: now,
  });
}

export async function readCpanelCredential(
  userId: string,
): Promise<CpanelCredentialPayload | null> {
  const rows = await db
    .select()
    .from(schema.cpanelCredentials)
    .where(eq(schema.cpanelCredentials.userId, userId))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  const apiToken = decrypt(
    { ciphertext: r.apiTokenCipher, iv: r.iv, authTag: r.authTag },
    aadFor(userId),
  );
  // Bump lastUsedAt fire-and-forget — useful in audit, never blocks the read.
  void db
    .update(schema.cpanelCredentials)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.cpanelCredentials.id, r.id))
    .catch(() => {});
  return {
    username: r.username,
    apiToken,
    serverUrl: r.serverUrl,
    verifySsl: r.verifySsl,
  };
}

export async function readCpanelStatus(
  userId: string,
): Promise<CpanelCredentialStatus> {
  const rows = await db
    .select({
      username: schema.cpanelCredentials.username,
      serverUrl: schema.cpanelCredentials.serverUrl,
      verifySsl: schema.cpanelCredentials.verifySsl,
      updatedAt: schema.cpanelCredentials.updatedAt,
      lastUsedAt: schema.cpanelCredentials.lastUsedAt,
    })
    .from(schema.cpanelCredentials)
    .where(eq(schema.cpanelCredentials.userId, userId))
    .limit(1);
  if (rows.length === 0) {
    return {
      connected: false,
      username: null,
      serverUrl: null,
      verifySsl: true,
      updatedAt: null,
      lastUsedAt: null,
    };
  }
  const r = rows[0];
  return {
    connected: true,
    username: r.username,
    serverUrl: r.serverUrl,
    verifySsl: r.verifySsl,
    updatedAt: r.updatedAt,
    lastUsedAt: r.lastUsedAt,
  };
}

export async function deleteCpanelCredential(userId: string): Promise<void> {
  await db
    .delete(schema.cpanelCredentials)
    .where(eq(schema.cpanelCredentials.userId, userId));
}
