import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import "@/lib/openclaw/services"; // register plugins
import { getManagedMcpService } from "@/lib/openclaw/managed-mcp";
import { readOauthApp } from "@/lib/credentials/oauth-app";
import { signOAuthState } from "@/lib/oauth/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Generic OAuth start endpoint. Redirects the browser to the provider's
 * authorization URL with a signed `state` that pins the userId + service.
 *
 *   GET /api/portal/users/<userId>/services/<service>/oauth/start
 *     → 302 to provider
 *
 * Plugins declare `auth.kind === "oauth"` plus the provider's authorization
 * URL, default scopes, and any extra query params (e.g. `prompt=consent`,
 * `access_type=offline`). The tenant admin must have configured the OAuth
 * app at `/api/portal/services/<svc>/oauth-app` first; the redirect URI we
 * pass to the provider matches what's stored there exactly.
 */
export async function GET(
  _req: Request,
  {
    params,
  }: { params: Promise<{ userId: string; service: string }> },
) {
  const { userId, service } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin" && session.user.id !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const svc = getManagedMcpService(service);
  if (!svc) {
    return NextResponse.json(
      { error: `unknown service '${service}'` },
      { status: 404 },
    );
  }
  if (svc.auth.kind !== "oauth") {
    return NextResponse.json(
      {
        error: `service '${service}' does not use OAuth — POST credentials directly to /api/portal/users/${userId}/services/${service} instead.`,
      },
      { status: 400 },
    );
  }

  const userRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (userRows.length === 0) {
    return NextResponse.json({ error: "no such user" }, { status: 404 });
  }

  const app = await readOauthApp(service);
  if (!app) {
    return NextResponse.json(
      {
        error: `tenant OAuth app for '${service}' not configured — admin must POST client_id/client_secret/redirect_uri to /api/portal/services/${service}/oauth-app first.`,
      },
      { status: 412 },
    );
  }

  const state = signOAuthState(userId, service);
  const url = new URL(svc.auth.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", app.clientId);
  url.searchParams.set("redirect_uri", app.redirectUri);
  url.searchParams.set("scope", svc.auth.scopes.join(" "));
  url.searchParams.set("state", state);
  if (svc.auth.authorizationParams) {
    for (const [k, v] of Object.entries(svc.auth.authorizationParams)) {
      url.searchParams.set(k, v);
    }
  }

  return NextResponse.redirect(url.toString(), { status: 302 });
}
