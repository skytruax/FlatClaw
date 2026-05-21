import { NextResponse } from "next/server";
import { resolveCapabilityToken } from "@/lib/oauth/capability-tokens";
import { readJiraCredential } from "@/lib/credentials/jira";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Capability-token-gated bridge that returns a user's Atlassian Jira
 * credentials (email + workspace URL + API token) for use by the per-user
 * Jira MCP wrapper.
 *
 * Strict guards:
 *   - Source must be loopback (127.0.0.1 / ::1)
 *   - Authorization: Bearer <capability_token>
 *   - The token resolves to (userId, scope=jira.token) in
 *     agent_capabilities and is not revoked
 *   - The user must have Jira creds in the vault
 *
 * Atlassian API tokens are long-lived (no refresh), so this endpoint is
 * dumb: decrypt + return. The MCP caches the response on a short TTL.
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
  if (!cap || cap.scope !== "jira.token")
    return NextResponse.json({ error: "invalid capability" }, { status: 401 });

  const creds = await readJiraCredential(cap.userId);
  if (!creds)
    return NextResponse.json(
      { ok: false, error: "no jira credentials configured for user" },
      { status: 404 },
    );

  return NextResponse.json({
    ok: true,
    email: creds.email,
    workspace_url: creds.workspaceUrl,
    api_token: creds.apiToken,
  });
}
