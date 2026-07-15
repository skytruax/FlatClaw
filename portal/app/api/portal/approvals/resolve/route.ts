import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import {
  findPending,
  resolveApproval,
  type ApprovalDecision,
} from "@/lib/openclaw/approvals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Record a human sign-off (approve/deny) on a pending transfer. The pending
 * transfer is re-resolved server-side from the transcript (never trusts a
 * client-supplied snapshot), and a non-admin can only act on their own agent.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    toolCallId?: string;
    decision?: string;
    agent?: string;
  };
  const toolCallId = String(body.toolCallId ?? "");
  const decision: ApprovalDecision | null =
    body.decision === "approved"
      ? "approved"
      : body.decision === "denied"
        ? "denied"
        : null;
  if (!toolCallId || !decision)
    return NextResponse.json({ error: "bad request" }, { status: 400 });

  // Resolve the acting agent + target user with the same trust boundary as the
  // history route: admins may target any agent, everyone else only their own.
  let agentId: string | null = null;
  let targetUserId: string | null = null;
  if (session.user.role === "admin" && body.agent) {
    agentId = body.agent;
    const u = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.agentId, body.agent))
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

  const pending = await findPending(agentId, toolCallId);
  if (!pending)
    return NextResponse.json(
      { error: "no such pending transfer" },
      { status: 404 },
    );

  try {
    const { confirmationRef, alreadyResolved, executionSummary } = await resolveApproval({
      pending,
      decision,
      approverUserId: session.user.id,
      targetUserId,
    });
    return NextResponse.json({
      ok: true,
      decision,
      confirmationRef,
      alreadyResolved,
      executionSummary,
    });
  } catch (err) {
    // Execution failed — the item stays pending (no decision recorded).
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
