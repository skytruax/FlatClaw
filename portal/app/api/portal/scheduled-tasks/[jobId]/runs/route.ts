/**
 * Run history for a scheduled task — `cron.runs { id }`. Each entry has the
 * run timestamp, status, duration, error text, and the session the run
 * executed in (so the UI can link to the transcript).
 *
 *   GET /api/portal/scheduled-tasks/[jobId]/runs[?targetUserId=…&limit=]  → { runs }
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getGatewayClient } from "@/lib/openclaw/adapter";
import {
  getOwnedCronJob,
  resolveActingAgent,
  ScheduledTaskForbidden,
  ScheduledTaskNotFound,
  toScheduledRunDTO,
} from "@/lib/scheduler/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
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
  const { agentId } = resolved.agent;

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

  const limitParamRaw = url.searchParams.get("limit");
  const limit = Math.max(1, Math.min(200, Number(limitParamRaw) || 50));

  try {
    const client = getGatewayClient();
    const r = (await client.call("cron.runs", {
      id: jobId,
      limit,
      sortDir: "desc",
    })) as { entries?: Array<Parameters<typeof toScheduledRunDTO>[0]> };
    return NextResponse.json({ runs: (r.entries ?? []).map(toScheduledRunDTO) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
