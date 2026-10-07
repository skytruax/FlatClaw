/**
 * One-shot migration: legacy `oauth_tokens` (provider=google) +
 * `oauth_app_config` rows → generic `service_oauth_tokens` (service=gmail) +
 * `service_oauth_apps` (service=gmail).
 *
 * The legacy AAD strings are pinned literally here so we never re-derive
 * them from the source files (which will get deleted in the cleanup phase
 * after this script has run).
 *
 * Idempotent: skips rows that already exist in the new tables. Safe to
 * re-run if interrupted.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-google-to-gmail.ts
 */
import { db, schema } from "@/lib/db/client";
import { eq, and } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/crypto/aes-gcm";
import { randomUUID } from "node:crypto";

const LEGACY_AAD_APP = "oauth_app_config:google";
const LEGACY_AAD_ACCESS = "oauth_token:google:access";
const LEGACY_AAD_REFRESH = "oauth_token:google:refresh";

const NEW_AAD_APP = "service-oauth-app:gmail";
const NEW_AAD_ACCESS = "service-oauth:gmail:";   // suffixed with ${userId}:access
const NEW_AAD_REFRESH = "service-oauth:gmail:";  // suffixed with ${userId}:refresh

async function migrateAppConfig() {
  const legacy = await db.select().from(schema.oauthAppConfig).limit(1);
  if (legacy.length === 0) {
    console.log("[app-config] no legacy oauth_app_config row — skip");
    return;
  }
  const r = legacy[0];
  if (!r.googleClientId || !r.googleClientSecretCipher || !r.iv || !r.authTag || !r.redirectUri) {
    console.log("[app-config] legacy row missing fields — skip");
    return;
  }

  const existing = await db
    .select()
    .from(schema.serviceOauthApps)
    .where(eq(schema.serviceOauthApps.service, "gmail"))
    .limit(1);
  if (existing.length > 0) {
    console.log("[app-config] service_oauth_apps[service=gmail] already exists — skip");
    return;
  }

  const clientSecret = decrypt(
    {
      ciphertext: r.googleClientSecretCipher,
      iv: r.iv,
      authTag: r.authTag,
    },
    LEGACY_AAD_APP,
  );
  const sealed = encrypt(clientSecret, NEW_AAD_APP);

  // Operator note: the legacy redirect_uri points at /oauth/google/callback;
  // the new generic callback is /oauth/gmail/callback. We rewrite it here
  // and the operator must update the registered redirect URI in Google
  // Cloud Console too. Leaving the old path in DB would silently break
  // OAuth on first use.
  const newRedirect = (r.redirectUri ?? "").replace(
    /\/api\/portal\/oauth\/google\/callback$/,
    "/api/portal/oauth/gmail/callback",
  );

  await db.insert(schema.serviceOauthApps).values({
    service: "gmail",
    clientId: r.googleClientId,
    clientSecretCipher: sealed.ciphertext,
    clientSecretIv: sealed.iv,
    clientSecretAuthTag: sealed.authTag,
    redirectUri: newRedirect,
  });
  console.log(
    "[app-config] inserted service_oauth_apps[gmail] — redirect rewritten:",
    r.redirectUri,
    "→",
    newRedirect,
  );
  console.log(
    "[app-config] ACTION REQUIRED: update Google Cloud Console authorized-redirect URI to:",
    newRedirect,
  );
}

async function migrateTokens() {
  const rows = await db
    .select()
    .from(schema.oauthTokens)
    .where(eq(schema.oauthTokens.provider, "google"));
  console.log(`[tokens] found ${rows.length} legacy oauth_tokens rows`);

  for (const r of rows) {
    const existing = await db
      .select()
      .from(schema.serviceOauthTokens)
      .where(
        and(
          eq(schema.serviceOauthTokens.userId, r.userId),
          eq(schema.serviceOauthTokens.service, "gmail"),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      console.log(`[tokens] user=${r.userId} already migrated — skip`);
      continue;
    }

    const accessToken = decrypt(
      {
        ciphertext: r.accessTokenCipher,
        iv: r.accessIv,
        authTag: r.accessAuthTag,
      },
      LEGACY_AAD_ACCESS,
    );
    let refreshToken: string | null = null;
    if (r.refreshTokenCipher && r.refreshIv && r.refreshAuthTag) {
      refreshToken = decrypt(
        {
          ciphertext: r.refreshTokenCipher,
          iv: r.refreshIv,
          authTag: r.refreshAuthTag,
        },
        LEGACY_AAD_REFRESH,
      );
    }

    const accessSealed = encrypt(
      accessToken,
      `${NEW_AAD_ACCESS}${r.userId}:access`,
    );
    const refreshSealed = refreshToken
      ? encrypt(refreshToken, `${NEW_AAD_REFRESH}${r.userId}:refresh`)
      : null;

    await db.insert(schema.serviceOauthTokens).values({
      id: randomUUID(),
      userId: r.userId,
      service: "gmail",
      identity: r.email,
      accessTokenCipher: accessSealed.ciphertext,
      accessIv: accessSealed.iv,
      accessAuthTag: accessSealed.authTag,
      refreshTokenCipher: refreshSealed?.ciphertext ?? null,
      refreshIv: refreshSealed?.iv ?? null,
      refreshAuthTag: refreshSealed?.authTag ?? null,
      scope: r.scope,
      expiresAt: r.expiresAt,
    });
    console.log(`[tokens] migrated user=${r.userId} email=${r.email}`);
  }
}

async function main() {
  await migrateAppConfig();
  await migrateTokens();
  console.log("[migrate] done. legacy rows are still in oauth_tokens / oauth_app_config — drop them manually after verifying.");
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
