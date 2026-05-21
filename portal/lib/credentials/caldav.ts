import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/crypto/aes-gcm";

/**
 * Mailbox-account credential vault (CalDAV / CardDAV / IMAP / SMTP).
 *
 * One row per (userId). Plaintext payload is the email-account password —
 * everything else (email address, DAV URL, IMAP/SMTP host:port) is plain
 * config metadata.
 *
 * AAD pins each ciphertext to "caldav:<userId>" — copying a row to another
 * userId's slot fails GCM verification. Mirrors the cpanel vault shape.
 */

const AAD_PREFIX = "caldav-credential";

function aadFor(userId: string): string {
  return `${AAD_PREFIX}:${userId}`;
}

export interface CaldavCredentialPayload {
  email: string;
  password: string;
  davUrl: string;
  imapHost?: string | null;
  imapPort?: number | null;
  imapSecure?: boolean | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean | null;
}

export interface CaldavCredentialStatus {
  connected: boolean;
  email: string | null;
  davUrl: string | null;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  updatedAt: Date | null;
  lastUsedAt: Date | null;
}

export async function setCaldavCredential(
  userId: string,
  payload: CaldavCredentialPayload,
): Promise<void> {
  const sealed = encrypt(payload.password, aadFor(userId));
  const now = new Date();
  const existing = await db
    .select()
    .from(schema.caldavCredentials)
    .where(eq(schema.caldavCredentials.userId, userId))
    .limit(1);

  const record = {
    email: payload.email,
    davUrl: payload.davUrl,
    imapHost: payload.imapHost ?? null,
    imapPort: payload.imapPort ?? null,
    imapSecure: payload.imapSecure ?? null,
    smtpHost: payload.smtpHost ?? null,
    smtpPort: payload.smtpPort ?? null,
    smtpSecure: payload.smtpSecure ?? null,
    passwordCipher: sealed.ciphertext,
    iv: sealed.iv,
    authTag: sealed.authTag,
    updatedAt: now,
  };

  if (existing.length > 0) {
    await db
      .update(schema.caldavCredentials)
      .set(record)
      .where(eq(schema.caldavCredentials.id, existing[0].id));
    return;
  }
  await db.insert(schema.caldavCredentials).values({
    id: randomUUID(),
    userId,
    ...record,
    createdAt: now,
  });
}

export async function readCaldavCredential(
  userId: string,
): Promise<CaldavCredentialPayload | null> {
  const rows = await db
    .select()
    .from(schema.caldavCredentials)
    .where(eq(schema.caldavCredentials.userId, userId))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  const password = decrypt(
    { ciphertext: r.passwordCipher, iv: r.iv, authTag: r.authTag },
    aadFor(userId),
  );
  void db
    .update(schema.caldavCredentials)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.caldavCredentials.id, r.id))
    .catch(() => {});
  return {
    email: r.email,
    password,
    davUrl: r.davUrl,
    imapHost: r.imapHost,
    imapPort: r.imapPort,
    imapSecure: r.imapSecure,
    smtpHost: r.smtpHost,
    smtpPort: r.smtpPort,
    smtpSecure: r.smtpSecure,
  };
}

export async function readCaldavStatus(
  userId: string,
): Promise<CaldavCredentialStatus> {
  const rows = await db
    .select({
      email: schema.caldavCredentials.email,
      davUrl: schema.caldavCredentials.davUrl,
      imapHost: schema.caldavCredentials.imapHost,
      imapPort: schema.caldavCredentials.imapPort,
      imapSecure: schema.caldavCredentials.imapSecure,
      smtpHost: schema.caldavCredentials.smtpHost,
      smtpPort: schema.caldavCredentials.smtpPort,
      smtpSecure: schema.caldavCredentials.smtpSecure,
      updatedAt: schema.caldavCredentials.updatedAt,
      lastUsedAt: schema.caldavCredentials.lastUsedAt,
    })
    .from(schema.caldavCredentials)
    .where(eq(schema.caldavCredentials.userId, userId))
    .limit(1);
  if (rows.length === 0) {
    return {
      connected: false,
      email: null,
      davUrl: null,
      imapHost: null,
      imapPort: null,
      imapSecure: null,
      smtpHost: null,
      smtpPort: null,
      smtpSecure: null,
      updatedAt: null,
      lastUsedAt: null,
    };
  }
  return { connected: true, ...rows[0] };
}

export async function deleteCaldavCredential(userId: string): Promise<void> {
  await db
    .delete(schema.caldavCredentials)
    .where(eq(schema.caldavCredentials.userId, userId));
}
