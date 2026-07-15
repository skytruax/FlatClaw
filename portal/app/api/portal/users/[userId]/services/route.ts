import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import "@/lib/openclaw/services"; // registers plugins
import {
  listManagedMcpServices,
  isServiceEnabled,
  getHiddenServices,
} from "@/lib/openclaw/managed-mcp";
import { readOauthAppStatus } from "@/lib/credentials/oauth-app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Returns every registered service plugin's descriptor + the user's status
 * for it. The admin UI renders one tile per entry.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin" && session.user.id !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Services hidden from the connections UI (admin Settings page) are omitted
  // here so a demo stays simple — visibility only, no effect on provisioning.
  const hidden = await getHiddenServices();
  const services = listManagedMcpServices().filter((s) => !hidden.has(s.service));
  const out = await Promise.all(
    services.map(async (svc) => {
      const [status, enabled, oauthApp] = await Promise.all([
        svc.readStatus(userId).catch((err) => ({
          connected: false,
          identity: null,
          meta: { error: err instanceof Error ? err.message : String(err) },
        })),
        isServiceEnabled(svc.service).catch(() => false),
        svc.auth.kind === "oauth"
          ? readOauthAppStatus(svc.service).catch(() => null)
          : Promise.resolve(null),
      ]);
      const authShape =
        svc.auth.kind === "form"
          ? { kind: "form" as const, fields: svc.auth.fields }
          : {
              kind: "oauth" as const,
              provider: svc.auth.provider,
              providerLabel: svc.auth.providerLabel,
              scopes: svc.auth.scopes,
              appConfigured: oauthApp?.configured === true,
            };
      return {
        service: svc.service,
        label: svc.label,
        emoji: svc.emoji ?? null,
        description: svc.description,
        auth: authShape,
        status,
        tenantEnabled: enabled,
      };
    }),
  );
  return NextResponse.json({
    ok: true,
    isAdmin: session.user.role === "admin",
    services: out,
  });
}
