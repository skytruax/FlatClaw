import { NextResponse } from "next/server";

import { ensureDomainIntentRuntime, parseIntentBody } from "@/lib/controlplane/intent-route";
import { ControlPlaneGatewayError } from "@/lib/controlplane/openclaw-adapter";
import type { CronDelivery, CronJobRestoreInput, CronPayload, CronSchedule } from "@/lib/cron/types";
import type { ControlPlaneRuntime } from "@/lib/controlplane/runtime";

export const runtime = "nodejs";

type CronJobSummaryLike = {
  id?: unknown;
  name?: unknown;
  agentId?: unknown;
  sessionKey?: unknown;
  description?: unknown;
  enabled?: unknown;
  deleteAfterRun?: unknown;
  schedule?: unknown;
  sessionTarget?: unknown;
  wakeMode?: unknown;
  payload?: unknown;
  delivery?: unknown;
};

type CronListResult = {
  jobs?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const parseCronJobRestoreInput = (
  value: CronJobSummaryLike,
  expectedAgentId: string
): CronJobRestoreInput => {
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id) {
    throw new Error("Cron job id is required.");
  }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) {
    throw new Error(`Cron job ${id} is missing name.`);
  }
  const enabled = value.enabled;
  if (typeof enabled !== "boolean") {
    throw new Error(`Cron job ${id} is missing enabled flag.`);
  }
  const sessionTarget = value.sessionTarget;
  if (sessionTarget !== "main" && sessionTarget !== "isolated") {
    throw new Error(`Cron job ${id} has invalid sessionTarget.`);
  }
  const wakeMode = value.wakeMode;
  if (wakeMode !== "next-heartbeat" && wakeMode !== "now") {
    throw new Error(`Cron job ${id} has invalid wakeMode.`);
  }
  const schedule = value.schedule;
  if (!isRecord(schedule)) {
    throw new Error(`Cron job ${id} is missing schedule.`);
  }
  const payload = value.payload;
  if (!isRecord(payload)) {
    throw new Error(`Cron job ${id} is missing payload.`);
  }
  const sessionKey = typeof value.sessionKey === "string" ? value.sessionKey : undefined;
  const description = typeof value.description === "string" ? value.description : undefined;
  const deleteAfterRun = typeof value.deleteAfterRun === "boolean" ? value.deleteAfterRun : undefined;
  const delivery = isRecord(value.delivery) ? (value.delivery as CronDelivery) : undefined;

  return {
    name,
    agentId: expectedAgentId,
    ...(sessionKey ? { sessionKey } : {}),
    ...(description ? { description } : {}),
    ...(typeof deleteAfterRun === "boolean" ? { deleteAfterRun } : {}),
    enabled,
    schedule: schedule as CronSchedule,
    sessionTarget,
    wakeMode,
    payload: payload as CronPayload,
    ...(delivery ? { delivery } : {}),
  };
};

const restoreJobsBestEffort = async (
  runtime: ControlPlaneRuntime,
  jobs: CronJobRestoreInput[]
): Promise<void> => {
  for (const job of jobs) {
    try {
      await runtime.callGateway("cron.add", job);
    } catch (error) {
      console.error("Failed to restore cron job after partial remove failure.", error);
    }
  }
};

const mapIntentError = (error: unknown): NextResponse => {
  if (error instanceof ControlPlaneGatewayError) {
    if (error.code.trim().toUpperCase() === "GATEWAY_UNAVAILABLE") {
      return NextResponse.json(
        {
          error: error.message,
          code: "GATEWAY_UNAVAILABLE",
          reason: "gateway_unavailable",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        details: error.details,
      },
      { status: 400 }
    );
  }
  const message = error instanceof Error ? error.message : "intent_failed";
  return NextResponse.json({ error: message }, { status: 500 });
};

export async function POST(request: Request) {
  const bodyOrError = await parseIntentBody(request);
  if (bodyOrError instanceof Response) {
    return bodyOrError as NextResponse;
  }

  const agentId = typeof bodyOrError.agentId === "string" ? bodyOrError.agentId.trim() : "";
  if (!agentId) {
    return NextResponse.json({ error: "agentId is required." }, { status: 400 });
  }

  const runtimeOrError = await ensureDomainIntentRuntime();
  if (runtimeOrError instanceof Response) {
    return runtimeOrError as NextResponse;
  }

  try {
    const listResult = await runtimeOrError.callGateway<CronListResult>("cron.list", {
      includeDisabled: true,
    });
    const jobs = Array.isArray(listResult.jobs)
      ? listResult.jobs.filter((entry): entry is CronJobSummaryLike => isRecord(entry))
      : [];
    const jobsForAgent = jobs.filter((job) => {
      const jobAgentId = typeof job.agentId === "string" ? job.agentId.trim() : "";
      return jobAgentId === agentId;
    });

    const removedJobs: CronJobRestoreInput[] = [];
    for (const job of jobsForAgent) {
      const jobId = typeof job.id === "string" ? job.id.trim() : "";
      if (!jobId) {
        throw new Error("Cron job id is required.");
      }

      let removeResult: unknown;
      try {
        removeResult = await runtimeOrError.callGateway("cron.remove", { id: jobId });
      } catch (error) {
        await restoreJobsBestEffort(runtimeOrError, removedJobs);
        throw error;
      }

      const ok = isRecord(removeResult) && removeResult.ok === true;
      if (!ok) {
        await restoreJobsBestEffort(runtimeOrError, removedJobs);
        throw new Error(`Failed to delete cron job \"${jobId}\".`);
      }

      const removed = isRecord(removeResult) && removeResult.removed === true;
      if (removed) {
        removedJobs.push(parseCronJobRestoreInput(job, agentId));
      }
    }

    return NextResponse.json({
      ok: true,
      payload: {
        removedJobs,
      },
    });
  } catch (error) {
    return mapIntentError(error);
  }
}
