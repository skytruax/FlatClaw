/**
 * Run a scheduled task on demand — `cron.run { mode: "force" }`. Bypasses the
 * schedule, runs the agent turn immediately, and logs as a normal run. Lets a
 * user test a task right after creating it.
 *
 *   POST /api/portal/scheduled-tasks/[jobId]/run  → { ok, ran, reason? }
 */
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { getGatewayClient } from "@/lib/openclaw/adapter";
import {
  getOwnedCronJob,
  resolveActingAgent,
  ScheduledTaskForbidden,
  ScheduledTaskNotFound,
} from "@/lib/scheduler/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { jobId } = await params;

  const body = (await req.json().catch(() => ({}))) as { targetUserId?: string };
  const resolved = await resolveActingAgent(
    session.user.id,
    session.user.role === "admin",
    body.targetUserId,
  );
  if (!resolved.ok)
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { agentId, userId: targetUserId } = resolved.agent;

  try {
    await getOwnedCronJob(jobId, agentId);
  } catch (err) {
    if (err instanceof ScheduledTaskNotFound)
      return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof ScheduledTaskForbidden)
      return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  try {
    const client = getGatewayClient();
    const result = (await client.call("cron.run", { id: jobId, mode: "force" })) as {
      ok?: boolean;
      ran?: boolean;
      reason?: string;
    };
    await db.insert(schema.auditLog).values({
      id: randomUUID(),
      actorUserId: session.user.id,
      action: "scheduler.run-now",
      targetUserId,
      metadata: { jobId, result },
    });
    return NextResponse.json({
      ok: result.ok !== false,
      ran: !!result.ran,
      reason: result.reason ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
