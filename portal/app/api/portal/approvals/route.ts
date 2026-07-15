import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { listApprovals } from "@/lib/openclaw/approvals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Transfer-approval queue for the acting user's agent. Admin may inspect any
 * agent via ?agent=<agentId>; a non-admin is always scoped to their own agent.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const agentOverride = new URL(req.url).searchParams.get("agent");

  let agentId: string | null = null;
  let targetUserId: string | null = null;
  if (session.user.role === "admin" && agentOverride) {
    agentId = agentOverride;
    const u = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.agentId, agentOverride))
      .limit(1);
    targetUserId = u[0]?.id ?? null;
  } else {
    const me = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, session.user.id))
      .limit(1);
    agentId = me[0]?.agentId ?? null;
    targetUserId = me[0]?.id ?? null;
  }
  if (!agentId)
    return NextResponse.json({ error: "user has no agent" }, { status: 400 });

  try {
    const { pending, resolved } = await listApprovals(agentId);
    return NextResponse.json({ agentId, targetUserId, pending, resolved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
