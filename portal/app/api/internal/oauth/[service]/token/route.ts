import { NextResponse } from "next/server";
import "@/lib/openclaw/services"; // register plugins
import { resolveCapabilityToken } from "@/lib/oauth/capability-tokens";
import { getValidServiceAccessToken } from "@/lib/credentials/oauth-token-bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Capability-token-gated bridge endpoint.
 *
 *   GET /api/internal/oauth/<service>/token
 *     Authorization: Bearer <capability_token>
 *     → { ok, access_token, expires_at, identity, scope }
 *
 * Loopback only. The presented capability token must have scope
 * `<service>.token`. Returns a fresh provider access token (refreshing via
 * the plugin's refreshAccessToken hook when needed). Refresh tokens never
 * leave the portal.
 *
 * Called by the per-user `<service>-<safeAgentId>` MCP wrapper at tool-call
 * time. Each call resolves a (userId, service) tuple → live access token,
 * which the wrapper then uses against the provider's REST API.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ service: string }> },
) {
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
  if (!isLoopback) {
    return NextResponse.json({ error: "loopback only" }, { status: 403 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)/i.exec(authHeader);
  if (!m) {
    return NextResponse.json({ error: "missing bearer" }, { status: 401 });
  }
  const presented = m[1];

  const { service } = await params;
  const cap = await resolveCapabilityToken(presented);
  if (!cap) {
    return NextResponse.json({ error: "invalid capability" }, { status: 401 });
  }
  if (cap.scope !== `${service}.token`) {
    return NextResponse.json(
      {
        error: `capability scope '${cap.scope}' does not match expected '${service}.token'`,
      },
      { status: 403 },
    );
  }

  try {
    const t = await getValidServiceAccessToken(cap.userId, service);
    return NextResponse.json({
      ok: true,
      access_token: t.accessToken,
      expires_at: t.expiresAt?.toISOString() ?? null,
      identity: t.identity,
      scope: t.scope,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
