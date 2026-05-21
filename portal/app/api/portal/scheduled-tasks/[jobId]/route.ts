/**
 * Scheduled task — edit (pause/resume, rename, reschedule, retext) + delete.
 *
 *   PATCH  /api/portal/scheduled-tasks/[jobId]  → { task }
 *   DELETE /api/portal/scheduled-tasks/[jobId]  → { ok }
 */
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { getGatewayClient } from "@/lib/openclaw/adapter";
import { buildSchedule, isOneOff, ScheduleBuildError } from "@/lib/scheduler/cron-expr";
import {
  getOwnedCronJob,
  resolveActingAgent,
  ScheduledTaskForbidden,
  ScheduledTaskNotFound,
  toScheduledTaskDTO,
} from "@/lib/scheduler/server";
import type { UpdateScheduledTaskBody } from "@/lib/scheduler/contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ownershipError(err: unknown) {
  if (err instanceof ScheduledTaskNotFound)
    return NextResponse.json({ error: err.message }, { status: 404 });
  if (err instanceof ScheduledTaskForbidden)
    return NextResponse.json({ error: err.message }, { status: 403 });
  return null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { jobId } = await params;

  const body = (await req.json().catch(() => ({}))) as UpdateScheduledTaskBody;
  const resolved = await resolveActingAgent(
    session.user.id,
    session.user.role === "admin",
    body.targetUserId,
  );
  if (!resolved.ok)
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { agentId, userId: targetUserId } = resolved.agent;

  let current;
  try {
    current = await getOwnedCronJob(jobId, agentId);
  } catch (err) {
    const r = ownershipError(err);
    if (r) return r;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.description === "string") patch.description = body.description.trim();

  const payloadPatch: Record<string, unknown> = {};
  if (typeof body.instruction === "string" && body.instruction.trim())
    payloadPatch.message = body.instruction.trim();
  if (typeof body.thinking === "string" && body.thinking) payloadPatch.thinking = body.thinking;
  if (Object.keys(payloadPatch).length > 0)
    patch.payload = { kind: "agentTurn", ...payloadPatch };

  if (body.frequency && typeof body.frequency === "object") {
    const existingTz =
      current.schedule.kind === "cron" ? current.schedule.tz : undefined;
    const tz =
      (typeof body.timezone === "string" && body.timezone.trim()) ||
      existingTz ||
      "UTC";
    try {
      patch.schedule = buildSchedule(body.frequency, tz);
    } catch (err) {
      if (err instanceof ScheduleBuildError)
        return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }
    patch.deleteAfterRun = isOneOff(body.frequency);
  }

  if (typeof body.announce === "boolean")
    patch.delivery = body.announce ? { mode: "announce" } : { mode: "none" };

  if (Object.keys(patch).length === 0)
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  try {
    const client = getGatewayClient();
    const job = await client.call("cron.update", { id: jobId, patch });
    await db.insert(schema.auditLog).values({
      id: randomUUID(),
      actorUserId: session.user.id,
      action: "scheduler.update",
      targetUserId,
      metadata: { jobId, patch },
    });
    return NextResponse.json({
      task: toScheduledTaskDTO(job as Parameters<typeof toScheduledTaskDTO>[0]),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { jobId } = await params;

  const url = new URL(req.url);
  const resolved = await resolveActingAgent(
    session.user.id,
    session.user.role === "admin",
    url.searchParams.get("targetUserId"),
  );
  if (!resolved.ok)
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { agentId, userId: targetUserId } = resolved.agent;

  let job;
  try {
    job = await getOwnedCronJob(jobId, agentId);
  } catch (err) {
    const r = ownershipError(err);
    if (r) return r;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  try {
    const client = getGatewayClient();
    const result = (await client.call("cron.remove", { id: jobId })) as {
      removed?: boolean;
    };
    await db.insert(schema.auditLog).values({
      id: randomUUID(),
      actorUserId: session.user.id,
      action: "scheduler.delete",
      targetUserId,
      metadata: { jobId, name: job.name },
    });
    return NextResponse.json({ ok: true, removed: !!result.removed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
