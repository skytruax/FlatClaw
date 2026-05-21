import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import "@/lib/openclaw/services"; // registers plugins
import {
  getManagedMcpService,
  isServiceEnabled,
  setServiceEnabled,
} from "@/lib/openclaw/managed-mcp";
import { db, schema } from "@/lib/db/client";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Tenant-level service controls. Admin-only.
 *
 *   GET   /api/portal/services/<service>
 *     → { ok, service, enabled }
 *   PATCH /api/portal/services/<service>
 *     body: { enabled: boolean }
 *     → { ok, enabled, sync: { provisioned: [...userIds], deprovisioned: [...] } }
 *
 * The PATCH atomically writes the tenant flag AND syncs every user — if
 * we just enabled the service, every user with creds in the vault gets
 * their per-user MCP provisioned. If we disabled, every per-user MCP for
 * this service comes down. RBAC deny-lists recompute as a side effect.
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
  const { service } = await params;
  const guard = await requireAdmin();
  if ("error" in guard)
    return NextResponse.json({ error: guard.error }, { status: guard.status });

  const svc = getManagedMcpService(service);
  if (!svc)
    return NextResponse.json({ error: `unknown service ${service}` }, { status: 404 });
  const enabled = await isServiceEnabled(service);
  return NextResponse.json({ ok: true, service, enabled });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ service: string }> },
) {
  const { service } = await params;
  const guard = await requireAdmin();
  if ("error" in guard)
    return NextResponse.json({ error: guard.error }, { status: guard.status });

  const svc = getManagedMcpService(service);
  if (!svc)
    return NextResponse.json({ error: `unknown service ${service}` }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: "body must include `enabled: boolean`" },
      { status: 400 },
    );
  }

  let sync;
  try {
    sync = await setServiceEnabled(service, body.enabled);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  await db.insert(schema.auditLog).values({
    id: randomUUID(),
    actorUserId: guard.actorId,
    action: `service.${service}.${body.enabled ? "enable" : "disable"}`,
    targetUserId: null,
    metadata: {
      provisioned: sync.provisioned,
      deprovisioned: sync.deprovisioned,
      skipped: sync.skipped,
    },
  });

  return NextResponse.json({ ok: true, enabled: body.enabled, sync });
}
