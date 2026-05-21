import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { listOpenclawSkills } from "@/lib/openclaw/openclaw-skills";
import { listTenantEnabledSkills } from "@/lib/openclaw/tenant-skills";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/portal/users/<userId>/skills
 *
 * Returns the live list of openclaw OOTB skills, scoped to this user's
 * agent (so per-OS / per-host eligibility is evaluated correctly). The UI
 * renders one tile per skill with admin toggle + (when applicable) a
 * credentials form.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "admin" && session.user.id !== userId)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (rows.length === 0 || !rows[0].agentId)
    return NextResponse.json(
      { error: "user has no agent yet" },
      { status: 400 },
    );
  const agentId = rows[0].agentId;

  try {
    const [skills, tenantEnabledList] = await Promise.all([
      listOpenclawSkills(agentId),
      listTenantEnabledSkills(),
    ]);
    const tenantEnabled = new Set(tenantEnabledList);
    // Decorate each skill with the portal-tenant view: `tenantEnabled` is
    // OUR opinion on whether this skill should be visible to agents on this
    // tenant. openclaw's own `disabled` flag is preserved for the operator
    // who manages openclaw directly via its control UI.
    return NextResponse.json({
      ok: true,
      agentId,
      canAdmin: session.user.role === "admin",
      tenantAllowlist: tenantEnabledList,
      skills: skills.map((s) => ({
        ...s,
        tenantEnabled: tenantEnabled.has(s.name),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        ok: false,
      },
      { status: 502 },
    );
  }
}
