import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { db, schema } from "@/lib/db/client";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Capability scope namespace. One per managed service. Allowing arbitrary
 * `<service>.token` shapes keeps the type open enough for new plugins to
 * register without editing this file, while still typo-protecting the well-
 * known scopes.
 */
export type CapabilityScope =
  | "google.token"
  | "cpanel.token"
  | "caldav.token"
  | "jira.token"
  | `${string}.token`;

/**
 * Returns the capability token for a (user, scope) pair, minting a fresh one
 * if none exists (and revoking any prior token at the same scope).
 */
export async function ensureCapabilityToken(
  userId: string,
  scope: CapabilityScope,
): Promise<string> {
  // Live token already exists? Return it.
  const live = await db
    .select()
    .from(schema.agentCapabilities)
    .where(
      and(
        eq(schema.agentCapabilities.userId, userId),
        eq(schema.agentCapabilities.scope, scope),
        isNull(schema.agentCapabilities.revokedAt),
      ),
    )
    .limit(1);
  if (live.length > 0) return live[0].capabilityToken;

  // The unique index covers (userId, scope) without filtering on revokedAt,
  // so a previously-revoked row blocks INSERT. Update it in place instead.
  const stale = await db
    .select()
    .from(schema.agentCapabilities)
    .where(
      and(
        eq(schema.agentCapabilities.userId, userId),
        eq(schema.agentCapabilities.scope, scope),
      ),
    )
    .limit(1);

  const token = randomBytes(32).toString("hex");
  if (stale.length > 0) {
    await db
      .update(schema.agentCapabilities)
      .set({ capabilityToken: token, revokedAt: null })
      .where(eq(schema.agentCapabilities.id, stale[0].id));
    return token;
  }

  await db.insert(schema.agentCapabilities).values({
    id: randomUUID(),
    userId,
    capabilityToken: token,
    scope,
  });
  return token;
}

export async function revokeCapabilityToken(
  userId: string,
  scope: CapabilityScope,
): Promise<void> {
  await db
    .update(schema.agentCapabilities)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.agentCapabilities.userId, userId),
        eq(schema.agentCapabilities.scope, scope),
        isNull(schema.agentCapabilities.revokedAt),
      ),
    );
}

/**
 * Resolves a presented capability token to (userId, scope) if valid + not
 * revoked. Uses constant-time comparison.
 */
export async function resolveCapabilityToken(
  token: string,
): Promise<{ userId: string; scope: string } | null> {
  if (!token || token.length < 16) return null;
  const rows = await db
    .select()
    .from(schema.agentCapabilities)
    .where(
      and(
        eq(schema.agentCapabilities.capabilityToken, token),
        isNull(schema.agentCapabilities.revokedAt),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  const stored = rows[0].capabilityToken;
  // The select already filtered by exact match, but we still want a
  // constant-time check to avoid leaking via DB timing differences.
  const a = Buffer.from(stored, "utf8");
  const b = Buffer.from(token, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { userId: rows[0].userId, scope: rows[0].scope };
}
