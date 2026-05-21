/**
 * Scheduled tasks — list + create. Thin wrapper over openclaw's cron
 * subsystem (`cron.list` / `cron.add`). The portal keeps no job store; the
 * gateway owns timing, persistence, run history, and retries.
 *
 *   GET  /api/portal/scheduled-tasks[?targetUserId=…]  → { agentId, tasks }
 *   POST /api/portal/scheduled-tasks                   → { task }
 */
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { getGatewayClient } from "@/lib/openclaw/adapter";
import { buildSchedule, isOneOff, ScheduleBuildError } from "@/lib/scheduler/cron-expr";
import {
  listCronJobs,
  resolveActingAgent,
  toScheduledTaskDTO,
} from "@/lib/scheduler/server";
import type { CreateScheduledTaskBody } from "@/lib/scheduler/contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const resolved = await resolveActingAgent(
    session.user.id,
    session.user.role === "admin",
    url.searchParams.get("targetUserId"),
  );
  if (!resolved.ok)
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { agentId } = resolved.agent;

  try {
    const jobs = await listCronJobs();
    const tasks = jobs
      .filter((j) => j.agentId === agentId)
      .map(toScheduledTaskDTO);
    return NextResponse.json({ agentId, tasks });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as CreateScheduledTaskBody;
  const resolved = await resolveActingAgent(
    session.user.id,
    session.user.role === "admin",
    body.targetUserId,
  );
  if (!resolved.ok)
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { agentId, userId: targetUserId } = resolved.agent;

  const name = String(body.name ?? "").trim();
  const instruction = String(body.instruction ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!instruction)
    return NextResponse.json({ error: "instruction is required" }, { status: 400 });
  if (!body.frequency || typeof body.frequency !== "object")
    return NextResponse.json({ error: "frequency is required" }, { status: 400 });

  const tz =
    typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : "UTC";

  let schedule;
  try {
    schedule = buildSchedule(body.frequency, tz);
  } catch (err) {
    if (err instanceof ScheduleBuildError)
      return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  const thinking =
    typeof body.thinking === "string" && body.thinking ? body.thinking : "medium";

  try {
    const client = getGatewayClient();
    const job = await client.call("cron.add", {
      agentId,
      name,
      ...(body.description?.trim() ? { description: body.description.trim() } : {}),
      enabled: true,
      deleteAfterRun: isOneOff(body.frequency),
      schedule,
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: instruction, thinking },
      delivery: body.announce ? { mode: "announce" } : { mode: "none" },
    });

    await db.insert(schema.auditLog).values({
      id: randomUUID(),
      actorUserId: session.user.id,
      action: "scheduler.create",
      targetUserId,
      metadata: { jobId: (job as { id?: string }).id ?? null, name, schedule },
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
