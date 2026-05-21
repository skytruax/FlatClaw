import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import "@/lib/openclaw/services"; // register plugins
import { getManagedMcpService } from "@/lib/openclaw/managed-mcp";
import {
  setOauthApp,
  readOauthApp,
  readOauthAppStatus,
  deleteOauthApp,
} from "@/lib/credentials/oauth-app";
import { db, schema } from "@/lib/db/client";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Tenant-level OAuth app configuration. Admin-only.
 *
 *   GET    /api/portal/services/<service>/oauth-app
 *     → { ok, configured, clientId, redirectUri, updatedAt }
 *
 *   PATCH  /api/portal/services/<service>/oauth-app
 *     body: { clientId, clientSecret, redirectUri }
 *     → { ok, configured: true }
 *
 *   DELETE /api/portal/services/<service>/oauth-app
 *     → { ok: true }   (also wipes user OAuth tokens; rotating requires re-auth)
 *
 * Each plugin that uses OAuth (gmail, slack, notion, …) has exactly one row
 * here. The client_secret is encrypted at rest. The redirect URI must
 * match what the OAuth provider's app is registered with — typically
 * `<portal-base>/api/portal/oauth/<service>/callback`.
 */

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { error: "unauthorized" as const, status: 401 };
  if (session.user.role !== "admin")
    return { error: "admin only" as const, status: 403 };
  return { actorId: session.user.id };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ service: string }> },
) {
  const guard = await requireAdmin();
  if ("error" in guard)
    return NextResponse.json({ error: guard.error }, { status: guard.status });
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
      { error: `service '${service}' does not use OAuth` },
      { status: 400 },
    );
  }
  const status = await readOauthAppStatus(service);
  return NextResponse.json({
    ok: true,
    service,
    provider: svc.auth.provider,
    providerLabel: svc.auth.providerLabel,
    scopes: svc.auth.scopes,
    configured: status.configured,
    clientId: status.clientId,
    redirectUri: status.redirectUri,
    updatedAt: status.updatedAt,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ service: string }> },
) {
  const guard = await requireAdmin();
  if ("error" in guard)
    return NextResponse.json({ error: guard.error }, { status: guard.status });
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
      { error: `service '${service}' does not use OAuth` },
      { status: 400 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  const redirectUri =
    typeof body.redirectUri === "string" ? body.redirectUri.trim() : "";
  const clientSecretRaw =
    typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "clientId and redirectUri are required" },
      { status: 400 },
    );
  }

  // If the secret is omitted on PATCH, preserve the existing one (rotation
  // of clientId / redirectUri without re-supplying the secret is a common
  // operator action).
  let clientSecret = clientSecretRaw;
  if (!clientSecret) {
    const existing = await readOauthApp(service);
    if (!existing) {
      return NextResponse.json(
        {
          error:
            "clientSecret required on first configure (no existing secret to preserve)",
        },
        { status: 400 },
      );
    }
    clientSecret = existing.clientSecret;
  }

  await setOauthApp(service, { clientId, clientSecret, redirectUri });

  await db.insert(schema.auditLog).values({
    id: randomUUID(),
    actorUserId: guard.actorId,
    action: `service.${service}.oauth-app.set`,
    targetUserId: null,
    metadata: { clientId, redirectUri, secretRotated: clientSecretRaw !== "" },
  });

  return NextResponse.json({ ok: true, configured: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ service: string }> },
) {
  const guard = await requireAdmin();
  if ("error" in guard)
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { service } = await params;
  const svc = getManagedMcpService(service);
  if (!svc) {
    return NextResponse.json(
      { error: `unknown service '${service}'` },
      { status: 404 },
    );
  }
  await deleteOauthApp(service);
  await db.insert(schema.auditLog).values({
    id: randomUUID(),
    actorUserId: guard.actorId,
    action: `service.${service}.oauth-app.delete`,
    targetUserId: null,
    metadata: null,
  });
  return NextResponse.json({ ok: true });
}
