import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/crypto/aes-gcm";

/**
 * Jira credential vault.
 *
 * Per-user, AES-256-GCM-encrypted Atlassian API token storage. Atlassian
 * Cloud authenticates with HTTP Basic using `<email>:<api_token>` — the
 * token alone is the secret. Email + workspace URL are plaintext metadata
 * (configuration, not credentials).
 *
 * AAD pins each ciphertext to "jira:<userId>" — copy-paste of one user's
 * row to another user's slot fails GCM verification.
 *
 * No refresh lifecycle: Atlassian API tokens are long-lived until
 * manually revoked at https://id.atlassian.com/manage-profile/security/api-tokens.
 * Rotation = admin pastes a new token; we overwrite the row.
 */

const AAD_PREFIX = "jira-credential";

export interface JiraCredentialPayload {
  /** Atlassian account email — used as the basic-auth username. */
  email: string;
  /** Workspace URL, e.g. `https://kirktechsolutions.atlassian.net`. */
  workspaceUrl: string;
  /** The Atlassian API token, generated at id.atlassian.com. */
  apiToken: string;
}

export interface JiraCredentialStatus {
  connected: boolean;
  email: string | null;
  workspaceUrl: string | null;
  updatedAt: Date | null;
  lastUsedAt: Date | null;
}

function aadFor(userId: string): string {
  return `${AAD_PREFIX}:${userId}`;
}

function normalizeWorkspaceUrl(raw: string): string {
  // Strip trailing slash; the REST client appends `/rest/api/3/...`.
  return raw.replace(/\/+$/, "");
}

export async function setJiraCredential(
  userId: string,
  payload: JiraCredentialPayload,
): Promise<void> {
  const sealed = encrypt(payload.apiToken, aadFor(userId));
  const now = new Date();
  const workspaceUrl = normalizeWorkspaceUrl(payload.workspaceUrl);

  const existing = await db
    .select()
    .from(schema.jiraCredentials)
    .where(eq(schema.jiraCredentials.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.jiraCredentials)
      .set({
        email: payload.email,
        workspaceUrl,
        apiTokenCipher: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        updatedAt: now,
      })
      .where(eq(schema.jiraCredentials.id, existing[0].id));
    return;
  }

  await db.insert(schema.jiraCredentials).values({
    id: randomUUID(),
    userId,
    email: payload.email,
    workspaceUrl,
    apiTokenCipher: sealed.ciphertext,
    iv: sealed.iv,
    authTag: sealed.authTag,
    createdAt: now,
    updatedAt: now,
  });
}

export async function readJiraCredential(
  userId: string,
): Promise<JiraCredentialPayload | null> {
  const rows = await db
    .select()
    .from(schema.jiraCredentials)
    .where(eq(schema.jiraCredentials.userId, userId))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  const apiToken = decrypt(
    { ciphertext: r.apiTokenCipher, iv: r.iv, authTag: r.authTag },
    aadFor(userId),
  );
  // Fire-and-forget lastUsedAt bump — for the audit trail.
  void db
    .update(schema.jiraCredentials)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.jiraCredentials.id, r.id))
    .catch((err) => console.error("[jira] lastUsedAt update failed:", err));
  return {
    email: r.email,
    workspaceUrl: r.workspaceUrl,
    apiToken,
  };
}

export async function readJiraStatus(
  userId: string,
): Promise<JiraCredentialStatus> {
  const rows = await db
    .select({
      email: schema.jiraCredentials.email,
      workspaceUrl: schema.jiraCredentials.workspaceUrl,
      updatedAt: schema.jiraCredentials.updatedAt,
      lastUsedAt: schema.jiraCredentials.lastUsedAt,
    })
    .from(schema.jiraCredentials)
    .where(eq(schema.jiraCredentials.userId, userId))
    .limit(1);
  if (rows.length === 0) {
    return {
      connected: false,
      email: null,
      workspaceUrl: null,
      updatedAt: null,
      lastUsedAt: null,
    };
  }
  return { connected: true, ...rows[0] };
}

export async function deleteJiraCredential(userId: string): Promise<void> {
  await db
    .delete(schema.jiraCredentials)
    .where(eq(schema.jiraCredentials.userId, userId));
}
