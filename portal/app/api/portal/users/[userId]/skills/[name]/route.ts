import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { randomUUID } from "node:crypto";
import { setTenantSkillEnabled } from "@/lib/openclaw/tenant-skills";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Per-skill admin actions.
 *
 *   PATCH /api/portal/users/<userId>/skills/<name>
 *     body: { enabled: boolean }   // admin: tenant allowlist toggle
 *
 * Tenant enable/disable lives in our portal DB (`tenant_skill_settings`)
 * and is materialized into openclaw's `agents.defaults.skills` allowlist.
 * We deliberately do NOT touch `skills.entries.<name>.enabled` — that
 * would globally override openclaw's own opinion about the skill, which
 * we don't want (admins managing openclaw directly via the control UI
 * keep working as expected; our tenant policy layers on top via the
 * per-agent allowlist).
 *
 * Per-user credential connection for skills is a separate flow that
 * comes when openclaw lands per-agent skill env (or we wrap each skill
 * as a per-user MCP plugin). See docs/mcp-auth-plan.md §4.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string; name: string }> },
) {
  const { userId, name } = await params;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "admin")
    return NextResponse.json(
      { error: "admin only — tenant skill toggles affect every agent" },
      { status: 403 },
    );

  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: "body must include `enabled: boolean`" },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await setTenantSkillEnabled(name, body.enabled);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  await db.insert(schema.auditLog).values({
    id: randomUUID(),
    actorUserId: session.user.id,
    action: `skill.${name}.${body.enabled ? "tenant-enable" : "tenant-disable"}`,
    targetUserId: userId,
    metadata: { allowlist: result.allowlist },
  });

  return NextResponse.json({
    ok: true,
    enabled: body.enabled,
    allowlist: result.allowlist,
  });
}
