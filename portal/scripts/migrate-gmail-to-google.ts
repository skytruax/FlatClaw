/**
 * Rename plugin id `gmail` → `google` in the OAuth tables.
 *
 * Why: the OAuth scopes were always Google-wide (Gmail+Calendar+Drive+Docs+
 * Sheets+Contacts), and the per-user MCP wraps the `gog` CLI which exposes
 * all of them. Naming the plugin `gmail` was a misnomer.
 *
 * Steps:
 *   - Decrypt service_oauth_apps.client_secret under AAD `service-oauth-app:gmail`
 *     re-encrypt under `service-oauth-app:google`
 *   - For each service_oauth_tokens(service=gmail), decrypt access+refresh
 *     under `service-oauth:gmail:<userId>:{access,refresh}`, re-encrypt under
 *     `service-oauth:google:<userId>:{access,refresh}`
 *   - UPDATE the service column in both tables.
 *   - Re-mint cap-token rows: scope `gmail.token` → `google.token` (just
 *     renames the scope; the secret value stays).
 *   - Rewrite redirect URI `/oauth/gmail/callback` → `/oauth/google/callback`.
 *
 * Idempotent.
 */
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/crypto/aes-gcm";

const OLD = "gmail";
const NEW = "google";
const OLD_APP_AAD = `service-oauth-app:${OLD}`;
const NEW_APP_AAD = `service-oauth-app:${NEW}`;

function aadAccess(svc: string, userId: string) {
  return `service-oauth:${svc}:${userId}:access`;
}
function aadRefresh(svc: string, userId: string) {
  return `service-oauth:${svc}:${userId}:refresh`;
}

async function rekeyApps() {
  const rows = await db.select().from(schema.serviceOauthApps);
  for (const r of rows) {
    if (r.service !== OLD) continue;
    const existingNew = rows.find((x) => x.service === NEW);
    if (existingNew) {
      console.log("[apps] service=google already present — skip");
      return;
    }
    const secret = decrypt(
      {
        ciphertext: r.clientSecretCipher,
        iv: r.clientSecretIv,
        authTag: r.clientSecretAuthTag,
      },
      OLD_APP_AAD,
    );
    const sealed = encrypt(secret, NEW_APP_AAD);
    const newRedirect = (r.redirectUri ?? "").replace(
      /\/api\/portal\/oauth\/gmail\/callback$/,
      "/api/portal/oauth/google/callback",
    );
    await db.insert(schema.serviceOauthApps).values({
      service: NEW,
      clientId: r.clientId,
      clientSecretCipher: sealed.ciphertext,
      clientSecretIv: sealed.iv,
      clientSecretAuthTag: sealed.authTag,
      redirectUri: newRedirect,
    });
    await db
      .delete(schema.serviceOauthApps)
      .where(eq(schema.serviceOauthApps.service, OLD));
    console.log(
      `[apps] re-keyed: ${OLD} -> ${NEW}; redirect ${r.redirectUri} -> ${newRedirect}`,
    );
    if (newRedirect !== r.redirectUri) {
      console.log(
        `[apps] ACTION: update Google Cloud Console authorized-redirect URI to: ${newRedirect}`,
      );
    }
  }
}

async function rekeyTokens() {
  const rows = await db
    .select()
    .from(schema.serviceOauthTokens)
    .where(eq(schema.serviceOauthTokens.service, OLD));
  console.log(`[tokens] ${rows.length} rows to re-key`);
  for (const r of rows) {
    const accessPlain = decrypt(
      {
        ciphertext: r.accessTokenCipher,
        iv: r.accessIv,
        authTag: r.accessAuthTag,
      },
      aadAccess(OLD, r.userId),
    );
    let refreshPlain: string | null = null;
    if (r.refreshTokenCipher && r.refreshIv && r.refreshAuthTag) {
      refreshPlain = decrypt(
        {
          ciphertext: r.refreshTokenCipher,
          iv: r.refreshIv,
          authTag: r.refreshAuthTag,
        },
        aadRefresh(OLD, r.userId),
      );
    }
    const accessSealed = encrypt(accessPlain, aadAccess(NEW, r.userId));
    const refreshSealed = refreshPlain
      ? encrypt(refreshPlain, aadRefresh(NEW, r.userId))
      : null;
    await db
      .update(schema.serviceOauthTokens)
      .set({
        service: NEW,
        accessTokenCipher: accessSealed.ciphertext,
        accessIv: accessSealed.iv,
        accessAuthTag: accessSealed.authTag,
        refreshTokenCipher: refreshSealed?.ciphertext ?? null,
        refreshIv: refreshSealed?.iv ?? null,
        refreshAuthTag: refreshSealed?.authTag ?? null,
      })
      .where(eq(schema.serviceOauthTokens.id, r.id));
    console.log(`[tokens] re-keyed user=${r.userId}`);
  }
}

async function rekeyCaps() {
  // Just rename the scope on existing rows. The cap-token secret stays the
  // same so any in-flight MCPs keep working until they next re-fetch.
  const old = "gmail.token";
  const next = "google.token";
  const stale = await db
    .select()
    .from(schema.agentCapabilities)
    .where(eq(schema.agentCapabilities.scope, old));
  for (const r of stale) {
    // If the user already has a google.token row, drop the gmail.token one
    // (the cap value is independent of scope; we'll mint fresh on next use).
    const dupe = await db
      .select()
      .from(schema.agentCapabilities)
      .where(eq(schema.agentCapabilities.userId, r.userId));
    const hasGoogle = dupe.some(
      (x) => x.scope === next && x.revokedAt === null,
    );
    if (hasGoogle) {
      await db
        .delete(schema.agentCapabilities)
        .where(eq(schema.agentCapabilities.id, r.id));
      console.log(`[caps] dropped duplicate gmail.token for user=${r.userId}`);
    } else {
      await db
        .update(schema.agentCapabilities)
        .set({ scope: next })
        .where(eq(schema.agentCapabilities.id, r.id));
      console.log(`[caps] rescoped user=${r.userId}: gmail.token -> google.token`);
    }
  }
}

async function main() {
  await rekeyApps();
  await rekeyTokens();
  await rekeyCaps();
  console.log("[migrate] done");
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
