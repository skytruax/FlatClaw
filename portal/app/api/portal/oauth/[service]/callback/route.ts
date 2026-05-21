import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { verifyOAuthState } from "@/lib/oauth/state";
import { ensureCapabilityToken } from "@/lib/oauth/capability-tokens";
import { setServiceOauthToken } from "@/lib/credentials/oauth";
import { readOauthApp } from "@/lib/credentials/oauth-app";
import "@/lib/openclaw/services"; // register plugins
import {
  getManagedMcpService,
  isServiceEnabled,
  provisionManagedMcpForUser,
} from "@/lib/openclaw/managed-mcp";
import { syncSkillsForUser } from "@/lib/openclaw/sync-skills";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Generic OAuth callback. Verifies state, exchanges the code for tokens via
 * the plugin's `auth.exchangeCode` hook, persists into `service_oauth_tokens`,
 * mints a `<service>.token` capability, and provisions the per-user MCP if
 * the tenant has the service enabled.
 *
 *   GET /api/portal/oauth/<service>/callback?code=...&state=...
 *     → 302 back to /admin/users/<id> with `oauth_connected=<service>`
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ service: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const { service } = await params;
  const svc = getManagedMcpService(service);
  if (!svc) {
    return NextResponse.json(
      { error: `unknown service '${service}'` },
      { status: 404 },
    );
  }
  if (svc.auth.kind !== "oauth") {
    return NextResponse.json(
      { error: `service '${service}' is not an OAuth plugin` },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");
  if (errParam) {
    const back = new URL("/admin/users", req.url);
    back.searchParams.set("oauth_error", errParam);
    return NextResponse.redirect(back);
  }
  if (!code || !stateParam) {
    return NextResponse.json(
      { error: "missing code or state" },
      { status: 400 },
    );
  }

  let payload: { userId: string; service: string };
  try {
    payload = verifyOAuthState(stateParam);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
  if (payload.service !== service) {
    return NextResponse.json(
      {
        error: `state was minted for service '${payload.service}' but callback is for '${service}'`,
      },
      { status: 400 },
    );
  }
  if (
    session.user.role !== "admin" &&
    session.user.id !== payload.userId
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const app = await readOauthApp(service);
  if (!app) {
    return NextResponse.json(
      { error: `tenant OAuth app for '${service}' not configured` },
      { status: 412 },
    );
  }

  let bundle;
  try {
    bundle = await svc.auth.exchangeCode(
      code,
      app.clientId,
      app.clientSecret,
      app.redirectUri,
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: `code exchange failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }

  await setServiceOauthToken(payload.userId, service, {
    accessToken: bundle.accessToken,
    refreshToken: bundle.refreshToken ?? undefined,
    expiresAt: bundle.expiresAt ?? null,
    scope: bundle.scope ?? null,
    identity: bundle.identity ?? null,
  });

  // Mint the capability token now so the per-user MCP env (registered next)
  // can reference a stable cap token even before first use.
  await ensureCapabilityToken(payload.userId, `${service}.token`);

  // If the tenant has the service enabled, provision now so the user is
  // immediately usable. Otherwise leave it sitting in the vault — the
  // tenant-enable flow will pick it up later.
  let provisioned = false;
  let tenantEnabled = false;
  try {
    tenantEnabled = await isServiceEnabled(service);
    if (tenantEnabled) {
      const r = await provisionManagedMcpForUser(service, payload.userId);
      provisioned = r !== null;
    }
  } catch (err) {
    console.error(
      `[oauth/${service}/callback] provision failed (creds saved):`,
      err,
    );
  }

  // Refresh the per-agent prompt files so identity (e.g. gmail email) is
  // baked in. Best-effort.
  try {
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, payload.userId))
      .limit(1);
    if (rows[0]?.agentId) await syncSkillsForUser(payload.userId);
  } catch (err) {
    console.error(`[oauth/${service}/callback] syncSkillsForUser failed:`, err);
  }

  await db.insert(schema.auditLog).values({
    id: randomUUID(),
    actorUserId: session.user.id,
    action: `service.${service}.oauth.connect`,
    targetUserId: payload.userId,
    metadata: {
      identity: bundle.identity ?? null,
      tenantEnabled,
      provisioned,
    },
  });

  const back = new URL(`/admin/users/${payload.userId}`, req.url);
  back.searchParams.set("oauth_connected", service);
  return NextResponse.redirect(back);
}
