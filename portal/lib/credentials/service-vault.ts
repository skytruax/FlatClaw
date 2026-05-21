import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/db/client";
import { and, eq } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/crypto/aes-gcm";

/**
 * Generic per-(user, service) credential vault.
 *
 * One storage shape every managed MCP service can use — so adding a service
 * (public or private) needs no new table and the shared schema carries no
 * service-specific columns. Backs `service_credentials`.
 *
 *   - `data`   — non-secret metadata (username, server URL, role, vertical,
 *                host/port, …). Stored as JSON; service-defined shape.
 *   - `secret` — optional secret (API token, password) sealed with
 *                AES-256-GCM (PORTAL_SECRETS_KEY). AAD pins each ciphertext to
 *                `service-credential:<service>:<userId>` so a row can't be
 *                lifted into another (user, service) scope. Null when the
 *                service has no secret (e.g. a demo role tuple).
 */

function aadFor(service: string, userId: string): string {
  return `service-credential:${service}:${userId}`;
}

export interface ServiceCredentialInput {
  /** Non-secret metadata for the service. Replaces the stored value wholesale. */
  data?: Record<string, unknown> | null;
  /** Optional secret to seal. Pass `undefined` to leave an existing secret
   *  untouched on update; pass `null` to clear it. */
  secret?: string | null;
}

export interface ServiceCredentialRecord {
  data: Record<string, unknown> | null;
  secret: string | null;
}

export interface ServiceCredentialStatus {
  connected: boolean;
  data: Record<string, unknown> | null;
  updatedAt: Date | null;
  lastUsedAt: Date | null;
}

export async function setServiceCredential(
  userId: string,
  service: string,
  input: ServiceCredentialInput,
): Promise<void> {
  const now = new Date();
  const data = (input.data ?? null) as Record<string, unknown> | null;

  // Seal the secret only when one is provided. `undefined` => keep existing;
  // `null` => clear.
  let sealed: { ciphertext: string; iv: string; authTag: string } | null = null;
  const clearSecret = input.secret === null;
  if (typeof input.secret === "string" && input.secret.length > 0) {
    sealed = encrypt(input.secret, aadFor(service, userId));
  }

  const existing = await db
    .select()
    .from(schema.serviceCredentials)
    .where(
      and(
        eq(schema.serviceCredentials.userId, userId),
        eq(schema.serviceCredentials.service, service),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const patch: Record<string, unknown> = { data, updatedAt: now };
    if (sealed) {
      patch.secretCipher = sealed.ciphertext;
      patch.secretIv = sealed.iv;
      patch.secretAuthTag = sealed.authTag;
    } else if (clearSecret) {
      patch.secretCipher = null;
      patch.secretIv = null;
      patch.secretAuthTag = null;
    }
    await db
      .update(schema.serviceCredentials)
      .set(patch)
      .where(eq(schema.serviceCredentials.id, existing[0].id));
    return;
  }

  await db.insert(schema.serviceCredentials).values({
    id: randomUUID(),
    userId,
    service,
    data,
    secretCipher: sealed?.ciphertext ?? null,
    secretIv: sealed?.iv ?? null,
    secretAuthTag: sealed?.authTag ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

export async function readServiceCredential(
  userId: string,
  service: string,
): Promise<ServiceCredentialRecord | null> {
  const rows = await db
    .select()
    .from(schema.serviceCredentials)
    .where(
      and(
        eq(schema.serviceCredentials.userId, userId),
        eq(schema.serviceCredentials.service, service),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];

  // Fire-and-forget lastUsedAt bump for audit visibility.
  void db
    .update(schema.serviceCredentials)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.serviceCredentials.id, r.id))
    .catch(() => {});

  let secret: string | null = null;
  if (r.secretCipher && r.secretIv && r.secretAuthTag) {
    secret = decrypt(
      { ciphertext: r.secretCipher, iv: r.secretIv, authTag: r.secretAuthTag },
      aadFor(service, userId),
    );
  }
  return { data: (r.data ?? null) as Record<string, unknown> | null, secret };
}

export async function readServiceStatus(
  userId: string,
  service: string,
): Promise<ServiceCredentialStatus> {
  const rows = await db
    .select({
      data: schema.serviceCredentials.data,
      updatedAt: schema.serviceCredentials.updatedAt,
      lastUsedAt: schema.serviceCredentials.lastUsedAt,
    })
    .from(schema.serviceCredentials)
    .where(
      and(
        eq(schema.serviceCredentials.userId, userId),
        eq(schema.serviceCredentials.service, service),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    return { connected: false, data: null, updatedAt: null, lastUsedAt: null };
  }
  const r = rows[0];
  return {
    connected: true,
    data: (r.data ?? null) as Record<string, unknown> | null,
    updatedAt: r.updatedAt,
    lastUsedAt: r.lastUsedAt,
  };
}

export async function deleteServiceCredential(
  userId: string,
  service: string,
): Promise<void> {
  await db
    .delete(schema.serviceCredentials)
    .where(
      and(
        eq(schema.serviceCredentials.userId, userId),
        eq(schema.serviceCredentials.service, service),
      ),
    );
}
