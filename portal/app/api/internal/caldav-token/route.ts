import { NextResponse } from "next/server";
import { resolveCapabilityToken } from "@/lib/oauth/capability-tokens";
import { readCaldavCredential } from "@/lib/credentials/caldav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Capability-token-gated endpoint that returns the user's mailbox-account
 * credentials (email + password + DAV/IMAP/SMTP hosts). Same shape as
 * /api/internal/cpanel-token, but for the CalDav MCP.
 *
 * Strict guards:
 *   - Source must be loopback (127.0.0.1 / ::1)
 *   - Authorization: Bearer <capability_token>
 *   - The token resolves to (userId, scope=caldav.token), not revoked
 *   - The user must have caldav creds in the vault
 */
export async function GET(req: Request) {
  const xff = req.headers.get("x-forwarded-for");
  const remote =
    (xff?.split(",")[0]?.trim() ?? "") ||
    (req.headers.get("x-real-ip") ?? "") ||
    "";
  const isLoopback =
    remote === "" ||
    remote === "127.0.0.1" ||
    remote === "::1" ||
    remote === "::ffff:127.0.0.1";
  if (!isLoopback)
    return NextResponse.json({ error: "loopback only" }, { status: 403 });

  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)/i.exec(auth);
  if (!m) return NextResponse.json({ error: "missing bearer" }, { status: 401 });
  const token = m[1];

  const cap = await resolveCapabilityToken(token);
  if (!cap || cap.scope !== "caldav.token")
    return NextResponse.json({ error: "invalid capability" }, { status: 401 });

  const creds = await readCaldavCredential(cap.userId);
  if (!creds)
    return NextResponse.json(
      { ok: false, error: "no caldav credentials configured for user" },
      { status: 404 },
    );

  return NextResponse.json({
    ok: true,
    email: creds.email,
    password: creds.password,
    dav_url: creds.davUrl,
    imap_host: creds.imapHost,
    imap_port: creds.imapPort,
    imap_secure: creds.imapSecure,
    smtp_host: creds.smtpHost,
    smtp_port: creds.smtpPort,
    smtp_secure: creds.smtpSecure,
  });
}
