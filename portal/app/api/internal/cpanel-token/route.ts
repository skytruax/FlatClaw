import { NextResponse } from "next/server";
import { resolveCapabilityToken } from "@/lib/oauth/capability-tokens";
import { readCpanelCredential } from "@/lib/credentials/cpanel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Capability-token-gated endpoint that returns the fresh cPanel API token
 * (plus username + server URL) for the bearer's user. Called only by the
 * per-user cPanel MCP server spawned on the same host as the gateway.
 *
 * Strict guards:
 *   - Source must be loopback (127.0.0.1 / ::1)
 *   - Authorization: Bearer <capability_token>
 *   - The token resolves to (userId, scope=cpanel.token) in
 *     agent_capabilities and is not revoked
 *   - The user must have cPanel creds in the vault
 *
 * The actual API token never leaves the portal's process boundary except
 * through this loopback channel. The MCP holds it in memory only for the
 * duration of a tool call, then discards.
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
  if (!cap || cap.scope !== "cpanel.token")
    return NextResponse.json({ error: "invalid capability" }, { status: 401 });

  const creds = await readCpanelCredential(cap.userId);
  if (!creds)
    return NextResponse.json(
      { ok: false, error: "no cpanel credentials configured for user" },
      { status: 404 },
    );

  return NextResponse.json({
    ok: true,
    username: creds.username,
    api_token: creds.apiToken,
    server_url: creds.serverUrl,
    verify_ssl: creds.verifySsl,
  });
}
