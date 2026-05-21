import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/crypto/aes-gcm";

/**
 * Tenant-level OAuth-app config. One row per service plugin that uses
 * the OAuth flow (gmail, slack, notion, jira, hubspot, …). Admin sets
 * this once via the admin settings UI; users authorize per-user against
 * the same app afterward.
 *
 * Stored encrypted because the `client_secret` is a tenant-wide secret
 * (rotating it invalidates every user's refresh-token unless the
 * provider supports concurrent secrets — most do for a grace period).
 */

const AAD_PREFIX = "service-oauth-app";

function aadFor(service: string): string {
  return `${AAD_PREFIX}:${service}`;
}

export interface OauthAppPayload {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OauthAppStatus {
  configured: boolean;
  service: string;
  clientId: string | null;
  redirectUri: string | null;
  updatedAt: Date | null;
}

export async function setOauthApp(
  service: string,
  payload: OauthAppPayload,
): Promise<void> {
  const sealed = encrypt(payload.clientSecret, aadFor(service));
  const now = new Date();
  const existing = await db
    .select()
    .from(schema.serviceOauthApps)
    .where(eq(schema.serviceOauthApps.service, service))
    .limit(1);
  const record = {
    clientId: payload.clientId,
    clientSecretCipher: sealed.ciphertext,
    clientSecretIv: sealed.iv,
    clientSecretAuthTag: sealed.authTag,
    redirectUri: payload.redirectUri,
    updatedAt: now,
  };
  if (existing.length > 0) {
    await db
      .update(schema.serviceOauthApps)
      .set(record)
      .where(eq(schema.serviceOauthApps.service, service));
    return;
  }
  await db.insert(schema.serviceOauthApps).values({ service, ...record });
}

export async function readOauthApp(
  service: string,
): Promise<OauthAppPayload | null> {
  const rows = await db
    .select()
    .from(schema.serviceOauthApps)
    .where(eq(schema.serviceOauthApps.service, service))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  const clientSecret = decrypt(
    {
      ciphertext: r.clientSecretCipher,
      iv: r.clientSecretIv,
      authTag: r.clientSecretAuthTag,
    },
    aadFor(service),
  );
  return {
    clientId: r.clientId,
    clientSecret,
    redirectUri: r.redirectUri,
  };
}

export async function readOauthAppStatus(
  service: string,
): Promise<OauthAppStatus> {
  const rows = await db
    .select({
      clientId: schema.serviceOauthApps.clientId,
      redirectUri: schema.serviceOauthApps.redirectUri,
      updatedAt: schema.serviceOauthApps.updatedAt,
    })
    .from(schema.serviceOauthApps)
    .where(eq(schema.serviceOauthApps.service, service))
    .limit(1);
  if (rows.length === 0) {
    return {
      configured: false,
      service,
      clientId: null,
      redirectUri: null,
      updatedAt: null,
    };
  }
  return { configured: true, service, ...rows[0] };
}

export async function deleteOauthApp(service: string): Promise<void> {
  await db
    .delete(schema.serviceOauthApps)
    .where(eq(schema.serviceOauthApps.service, service));
}
