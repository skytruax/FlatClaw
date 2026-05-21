import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import "@/lib/openclaw/services"; // ensure plugins are registered
import {
  getManagedMcpService,
  provisionManagedMcpForUser,
  deprovisionManagedMcpForUser,
  isServiceEnabled,
} from "@/lib/openclaw/managed-mcp";
import { db, schema } from "@/lib/db/client";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Generic admin API for the per-user "service connection" pattern (form auth).
 *
 *   GET    /api/portal/users/<userId>/services/<service>
 *     → { ok, service, status: { connected, identity, ... } }
 *   POST   /api/portal/users/<userId>/services/<service>
 *     ONLY for plugins where `auth.kind === "form"`. OAuth-kind plugins
 *     return 400 with a redirect hint to /services/<svc>/oauth/start.
 *     body: the service's auth.fields shape (keyed by field.name)
 *     → { ok, provisioned: { serverName } | null }
 *   DELETE /api/portal/users/<userId>/services/<service>
 *     → { ok: true }
 *
 * The route delegates to the plugin descriptor for everything that varies
 * by service:
 *   - the credential validator (descriptor.auth.fields)
 *   - the vault writer (descriptor.setCredential)
 *   - the status reader (descriptor.readStatus)
 *   - the vault deleter (descriptor.deleteCredential)
 *
 * Provisioning + deprovisioning are 100% generic — the dispatcher in
 * `managed-mcp.ts` mints capability tokens, registers `mcp.servers.<name>`,
 * and recomputes RBAC deny lists. No per-service code in this file.
 */

async function requireActor(userId: string) {
  const session = await auth();
  if (!session?.user) return { error: "unauthorized" as const, status: 401 };
  // Admins can manage anyone; users can manage themselves.
  if (session.user.role !== "admin" && session.user.id !== userId) {
    return { error: "forbidden" as const, status: 403 };
  }
  return { actorId: session.user.id, role: session.user.role };
}

function assertService(service: string) {
  const svc = getManagedMcpService(service);
  if (!svc) {
    return NextResponse.json(
      { error: `unknown service '${service}'` },
      { status: 404 },
    );
  }
  return svc;
}

/** Coerce a payload field into the type the descriptor declares. */
function coerceField(
  raw: unknown,
  fieldType: "text" | "secret" | "url" | "number" | "boolean",
): unknown {
  if (raw === undefined || raw === null) return undefined;
  switch (fieldType) {
    case "number":
      if (typeof raw === "number") return raw;
      if (typeof raw === "string" && raw.trim() !== "") return Number(raw);
      return undefined;
    case "boolean":
      if (typeof raw === "boolean") return raw;
      if (raw === "true" || raw === "on" || raw === "1") return true;
      if (raw === "false" || raw === "off" || raw === "0") return false;
      return raw;
    default:
      return typeof raw === "string" ? raw : String(raw);
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string; service: string }> },
) {
  const { userId, service } = await params;
  const guard = await requireActor(userId);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const svc = assertService(service);
  if (svc instanceof NextResponse) return svc;

  const status = await svc.readStatus(userId);
  const authShape =
    svc.auth.kind === "form"
      ? { kind: "form" as const, fields: svc.auth.fields }
      : {
          kind: "oauth" as const,
          provider: svc.auth.provider,
          providerLabel: svc.auth.providerLabel,
          scopes: svc.auth.scopes,
        };
  return NextResponse.json({
    ok: true,
    service: {
      service: svc.service,
      label: svc.label,
      emoji: svc.emoji ?? null,
      description: svc.description,
      auth: authShape,
    },
    status,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string; service: string }> },
) {
  const { userId, service } = await params;
  const guard = await requireActor(userId);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const svc = assertService(service);
  if (svc instanceof NextResponse) return svc;
  if (svc.auth.kind !== "form") {
    return NextResponse.json(
      {
        error: `service '${svc.service}' uses OAuth — POST is only valid for form-auth services. Redirect the user to /api/portal/users/<id>/services/${svc.service}/oauth/start instead.`,
      },
      { status: 400 },
    );
  }
  if (!svc.setCredential) {
    return NextResponse.json(
      { error: `service '${svc.service}' is form-kind but has no setCredential hook — plugin bug` },
      { status: 500 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const payload: Record<string, unknown> = {};
  for (const f of svc.auth.fields) {
    const coerced = coerceField(body[f.name], f.type);
    if (coerced !== undefined) payload[f.name] = coerced;
    else if (f.defaultValue !== undefined) payload[f.name] = f.defaultValue;
  }
  // Required-field check.
  for (const f of svc.auth.fields) {
    const required = f.required ?? true;
    if (!required) continue;
    const v = payload[f.name];
    if (v === undefined || v === "" || v === null) {
      return NextResponse.json(
        { error: `field '${f.name}' is required` },
        { status: 400 },
      );
    }
  }

  await svc.setCredential(userId, payload);

  // The per-user MCP only goes up if the tenant admin has enabled this
  // service. Otherwise the credential sits in the vault waiting for an
  // admin enable, which will then trigger a sync that picks this user up.
  let provisioned: { serverName: string } | null = null;
  let serviceEnabled = false;
  let provisionError: string | null = null;
  try {
    serviceEnabled = await isServiceEnabled(svc.service);
    if (serviceEnabled) {
      const r = await provisionManagedMcpForUser(svc.service, userId);
      if (r) provisioned = { serverName: r.serverName };
    }
  } catch (err) {
    // Save the error so the admin sees "Credentials saved but provisioning
    // failed: <reason>" instead of a silent "Connected" with a half-wired
    // backend. We caught the silent-failure flavour during a pilot demo
    // prep: an env var was missing on the running portal process, provision
    // threw, the UI showed success — but no MCP server got registered.
    // Surfacing the message would have flagged it immediately.
    provisionError = err instanceof Error ? err.message : String(err);
    console.warn(
      `[services/${svc.service}] provision failed (creds saved):`,
      err,
    );
  }

  // Audit. We log payload field NAMES but not values — secrets must never
  // hit the audit log.
  await db.insert(schema.auditLog).values({
    id: randomUUID(),
    actorUserId: guard.actorId,
    action: `service.${svc.service}.credentials.set`,
    targetUserId: userId,
    metadata: {
      fields: Object.keys(payload),
      tenantEnabled: serviceEnabled,
      provisioned: !!provisioned,
    },
  });

  return NextResponse.json({
    ok: true,
    provisioned,
    tenantEnabled: serviceEnabled,
    provisionError,
    note: provisionError
      ? `Credentials saved, but provisioning the per-user MCP failed: ${provisionError}. Fix the underlying issue (typically a missing env var on the portal process) and toggle the service off/on, or use the admin sync flow to retry.`
      : !serviceEnabled
        ? "Credentials saved; the per-user MCP will be provisioned automatically once an admin enables this service tenant-wide."
        : null,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string; service: string }> },
) {
  const { userId, service } = await params;
  const guard = await requireActor(userId);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const svc = assertService(service);
  if (svc instanceof NextResponse) return svc;

  // Tear down gateway-side wiring first; vault delete is best-effort.
  try {
    await deprovisionManagedMcpForUser(svc.service, userId);
  } catch (err) {
    console.warn(
      `[services/${svc.service}] deprovision failed (continuing):`,
      err,
    );
  }
  await svc.deleteCredential(userId);

  await db.insert(schema.auditLog).values({
    id: randomUUID(),
    actorUserId: guard.actorId,
    action: `service.${svc.service}.credentials.delete`,
    targetUserId: userId,
    metadata: null,
  });

  return NextResponse.json({ ok: true });
}
