/**
 * Capability-token bridge for the CalDav MCP.
 *
 * The MCP starts with `CAPABILITY_TOKEN` + `PORTAL_BASE_URL` in env. On
 * first tool call (and on a short TTL refresh thereafter) it calls back to
 * the portal at `/api/internal/caldav-token` with `Authorization: Bearer
 * <CAPABILITY_TOKEN>` and gets back the user's email-account credentials.
 *
 * Refresh tokens / passwords never leave the portal beyond this loopback
 * channel; the MCP holds them in memory only for the cache window.
 *
 * For local-only single-user dev, you can also set MAILBOX_EMAIL +
 * MAILBOX_PASSWORD + MAILBOX_DAV_URL etc. directly — the `resolveCreds()`
 * function returns those if present. This mirrors cPanel MCP's two-mode
 * shape.
 */

export interface MailboxCreds {
  email: string;
  password: string;
  davUrl: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

export class MailboxAuthError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = "MailboxAuthError";
  }
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

let cached: { creds: MailboxCreds; fetchedAt: number } | null = null;

function readDirectEnv(): MailboxCreds | null {
  const email = process.env.MAILBOX_EMAIL;
  const password = process.env.MAILBOX_PASSWORD;
  const davUrl = process.env.MAILBOX_DAV_URL;
  if (!email || !password || !davUrl) return null;
  return {
    email,
    password,
    davUrl,
    imapHost: process.env.MAILBOX_IMAP_HOST ?? "",
    imapPort: Number(process.env.MAILBOX_IMAP_PORT ?? 993),
    imapSecure: process.env.MAILBOX_IMAP_SECURE !== "false",
    smtpHost: process.env.MAILBOX_SMTP_HOST ?? "",
    smtpPort: Number(process.env.MAILBOX_SMTP_PORT ?? 465),
    smtpSecure: process.env.MAILBOX_SMTP_SECURE !== "false",
  };
}

async function fetchFromBridge(): Promise<MailboxCreds> {
  const capToken = process.env.CAPABILITY_TOKEN;
  const portalBase = process.env.PORTAL_BASE_URL;
  if (!capToken || !portalBase) {
    throw new MailboxAuthError(
      "no creds: set MAILBOX_EMAIL+MAILBOX_PASSWORD+MAILBOX_DAV_URL, or CAPABILITY_TOKEN+PORTAL_BASE_URL",
    );
  }
  const url = portalBase.replace(/\/+$/, "") + "/api/internal/caldav-token";
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${capToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new MailboxAuthError(
      `bridge ${res.status}: ${body.slice(0, 250)}`,
      res.status,
    );
  }
  const data = (await res.json()) as {
    ok: boolean;
    email?: string;
    password?: string;
    dav_url?: string;
    imap_host?: string;
    imap_port?: number;
    imap_secure?: boolean;
    smtp_host?: string;
    smtp_port?: number;
    smtp_secure?: boolean;
    error?: string;
  };
  if (!data.ok || !data.email || !data.password || !data.dav_url) {
    throw new MailboxAuthError(
      `bridge returned no creds: ${data.error ?? "unknown"}`,
    );
  }
  return {
    email: data.email,
    password: data.password,
    davUrl: data.dav_url,
    imapHost: data.imap_host ?? new URL(data.dav_url).hostname,
    imapPort: data.imap_port ?? 993,
    imapSecure: data.imap_secure !== false,
    smtpHost: data.smtp_host ?? new URL(data.dav_url).hostname,
    smtpPort: data.smtp_port ?? 465,
    smtpSecure: data.smtp_secure !== false,
  };
}

const ttlMs = Number(process.env.MAILBOX_BRIDGE_TTL_MS) || DEFAULT_TTL_MS;

export async function resolveCreds(): Promise<MailboxCreds> {
  const direct = readDirectEnv();
  if (direct) return direct;
  const now = Date.now();
  if (cached && now - cached.fetchedAt < ttlMs) return cached.creds;
  const fresh = await fetchFromBridge();
  cached = { creds: fresh, fetchedAt: now };
  return fresh;
}
