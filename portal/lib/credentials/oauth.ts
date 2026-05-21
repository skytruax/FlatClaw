import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/db/client";
import { and, eq } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/crypto/aes-gcm";

/**
 * Generic per-(user, service) OAuth token vault.
 *
 * Replaces the Google-specific helpers in `lib/oauth/google.ts`. Every
 * service plugin that uses the OAuth flow stores tokens here:
 *
 *   - access token (always encrypted)
 *   - refresh token (encrypted, optional — some providers don't issue one)
 *   - identity (provider-specific account label, e.g. gmail email)
 *   - scope, expiresAt
 *
 * AAD pins each ciphertext to "service-oauth:<service>:<userId>:<part>"
 * so a row copied across (service, user, kind) fails GCM verification.
 *
 * The plugin descriptor's `auth.exchangeCode` and `auth.refreshAccessToken`
 * functions are the only callers that should know the provider-specific
 * token shape. Everything else routes through this vault.
 */

const AAD_PREFIX = "service-oauth";

function aadAccess(userId: string, service: string): string {
  return `${AAD_PREFIX}:${service}:${userId}:access`;
}
function aadRefresh(userId: string, service: string): string {
  return `${AAD_PREFIX}:${service}:${userId}:refresh`;
}

export interface OauthTokenPayload {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scope?: string | null;
  identity?: string | null;
}

export interface OauthTokenStatus {
  connected: boolean;
  identity: string | null;
  scope: string | null;
  expiresAt: Date | null;
  updatedAt: Date | null;
}

export async function setServiceOauthToken(
  userId: string,
  service: string,
  payload: OauthTokenPayload,
): Promise<void> {
  const accessSealed = encrypt(payload.accessToken, aadAccess(userId, service));
  const refreshSealed = payload.refreshToken
    ? encrypt(payload.refreshToken, aadRefresh(userId, service))
    : null;
  const now = new Date();

  const existing = await db
    .select()
    .from(schema.serviceOauthTokens)
    .where(
      and(
        eq(schema.serviceOauthTokens.userId, userId),
        eq(schema.serviceOauthTokens.service, service),
      ),
    )
    .limit(1);

  const record = {
    identity: payload.identity ?? null,
    scope: payload.scope ?? null,
    expiresAt: payload.expiresAt ?? null,
    accessTokenCipher: accessSealed.ciphertext,
    accessIv: accessSealed.iv,
    accessAuthTag: accessSealed.authTag,
    refreshTokenCipher: refreshSealed?.ciphertext ?? null,
    refreshIv: refreshSealed?.iv ?? null,
    refreshAuthTag: refreshSealed?.authTag ?? null,
    updatedAt: now,
  };

  if (existing.length > 0) {
    // Preserve the prior refresh token if the caller didn't provide a new
    // one — Google's refresh tokens persist across access-token rotations
    // and getting a new one requires `prompt=consent` re-authorization.
    const next =
      payload.refreshToken === undefined
        ? {
            ...record,
            refreshTokenCipher: existing[0].refreshTokenCipher,
            refreshIv: existing[0].refreshIv,
            refreshAuthTag: existing[0].refreshAuthTag,
          }
        : record;
    await db
      .update(schema.serviceOauthTokens)
      .set(next)
      .where(eq(schema.serviceOauthTokens.id, existing[0].id));
    return;
  }

  await db.insert(schema.serviceOauthTokens).values({
    id: randomUUID(),
    userId,
    service,
    ...record,
    createdAt: now,
  });
}

/** Decrypts and returns the access + refresh tokens. Null when not connected. */
export async function readServiceOauthToken(
  userId: string,
  service: string,
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
  expiresAt: Date | null;
  identity: string | null;
} | null> {
  const rows = await db
    .select()
    .from(schema.serviceOauthTokens)
    .where(
      and(
        eq(schema.serviceOauthTokens.userId, userId),
        eq(schema.serviceOauthTokens.service, service),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  const accessToken = decrypt(
    {
      ciphertext: r.accessTokenCipher,
      iv: r.accessIv,
      authTag: r.accessAuthTag,
    },
    aadAccess(userId, service),
  );
  const refreshToken =
    r.refreshTokenCipher && r.refreshIv && r.refreshAuthTag
      ? decrypt(
          {
            ciphertext: r.refreshTokenCipher,
            iv: r.refreshIv,
            authTag: r.refreshAuthTag,
          },
          aadRefresh(userId, service),
        )
      : null;
  return {
    accessToken,
    refreshToken,
    scope: r.scope,
    expiresAt: r.expiresAt,
    identity: r.identity,
  };
}

export async function readServiceOauthStatus(
  userId: string,
  service: string,
): Promise<OauthTokenStatus> {
  const rows = await db
    .select({
      identity: schema.serviceOauthTokens.identity,
      scope: schema.serviceOauthTokens.scope,
      expiresAt: schema.serviceOauthTokens.expiresAt,
      updatedAt: schema.serviceOauthTokens.updatedAt,
    })
    .from(schema.serviceOauthTokens)
    .where(
      and(
        eq(schema.serviceOauthTokens.userId, userId),
        eq(schema.serviceOauthTokens.service, service),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    return {
      connected: false,
      identity: null,
      scope: null,
      expiresAt: null,
      updatedAt: null,
    };
  }
  return { connected: true, ...rows[0] };
}

export async function deleteServiceOauthToken(
  userId: string,
  service: string,
): Promise<void> {
  await db
    .delete(schema.serviceOauthTokens)
    .where(
      and(
        eq(schema.serviceOauthTokens.userId, userId),
        eq(schema.serviceOauthTokens.service, service),
      ),
    );
}
