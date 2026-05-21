/**
 * Server-side helpers for the scheduled-tasks API routes: resolve which
 * openclaw agent the caller may act on, verify a cron job belongs to that
 * agent, and project openclaw's `CronJob` / run-log entries into the portal
 * DTOs. Node-only (touches the DB + gateway client).
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getGatewayClient } from "@/lib/openclaw/adapter";
import {
  describeSchedule,
  frequencyFromSchedule,
  type CronScheduleDTO,
} from "./cron-expr";
import type { ScheduledRunDTO, ScheduledTaskDTO } from "./contract";

export interface ActingAgent {
  /** The portal user the task surface is scoped to. */
  userId: string;
  /** Their openclaw agent id. */
  agentId: string;
}

/**
 * Resolve the agent the request operates on. Non-admins always get their own
 * agent; admins may pass `targetUserId` to act on another user (the same
 * pattern the chat-as routes use). Returns `null` (with a `reason`) when the
 * caller has no agent or the target doesn't exist.
 */
export async function resolveActingAgent(
  callerUserId: string,
  callerIsAdmin: boolean,
  targetUserId: string | null | undefined,
): Promise<{ ok: true; agent: ActingAgent } | { ok: false; status: number; error: string }> {
  const userId = callerIsAdmin && targetUserId ? targetUserId : callerUserId;
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const u = rows[0];
  if (!u) return { ok: false, status: 404, error: "no such user" };
  if (!u.agentId) {
    return { ok: false, status: 400, error: "user is not provisioned as an agent" };
  }
  return { ok: true, agent: { userId: u.id, agentId: u.agentId } };
}

interface RawCronJob {
  id: string;
  agentId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronScheduleDTO;
  payload?:
    | { kind: "agentTurn"; message: string; thinking?: string }
    | { kind: "systemEvent"; text: string };
  delivery?: { mode?: string };
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: "ok" | "error" | "skipped";
    lastStatus?: "ok" | "error" | "skipped";
    lastError?: string;
    lastDurationMs?: number;
    consecutiveErrors?: number;
    consecutiveSkipped?: number;
  };
}

interface CronListResult {
  jobs?: RawCronJob[];
}

/** Fetch every cron job on the gateway (portal filters by agent client-side). */
export async function listCronJobs(): Promise<RawCronJob[]> {
  const client = getGatewayClient();
  const r = (await client.call("cron.list", {
    includeDisabled: true,
    sortBy: "nextRunAtMs",
    sortDir: "asc",
    limit: 200,
  })) as CronListResult;
  return r.jobs ?? [];
}

/** Find a job by id and confirm it belongs to `agentId`. Throws otherwise. */
export async function getOwnedCronJob(jobId: string, agentId: string): Promise<RawCronJob> {
  const jobs = await listCronJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) throw new ScheduledTaskNotFound(jobId);
  if (job.agentId !== agentId) throw new ScheduledTaskForbidden(jobId);
  return job;
}

export class ScheduledTaskNotFound extends Error {
  constructor(jobId: string) {
    super(`scheduled task ${jobId} not found`);
  }
}
export class ScheduledTaskForbidden extends Error {
  constructor(jobId: string) {
    super(`scheduled task ${jobId} belongs to another agent`);
  }
}

/** Project openclaw's CronJob → portal DTO. */
export function toScheduledTaskDTO(job: RawCronJob): ScheduledTaskDTO {
  const st = job.state ?? {};
  const isAgentTurn = job.payload?.kind === "agentTurn";
  const instruction = isAgentTurn ? (job.payload as { message: string }).message : "";
  const thinking = isAgentTurn ? (job.payload as { thinking?: string }).thinking ?? null : null;
  return {
    id: job.id,
    agentId: job.agentId ?? null,
    name: job.name,
    description: job.description ?? null,
    enabled: !!job.enabled,
    oneOff: !!job.deleteAfterRun,
    schedule: job.schedule,
    scheduleSummary: describeSchedule(job.schedule),
    frequency: frequencyFromSchedule(job.schedule),
    instruction,
    thinking,
    announce: (job.delivery?.mode ?? "none") === "announce",
    nextRunAtMs: st.nextRunAtMs ?? null,
    lastRunAtMs: st.lastRunAtMs ?? null,
    lastRunStatus: st.lastRunStatus ?? st.lastStatus ?? null,
    lastError: st.lastError ?? null,
    lastDurationMs: st.lastDurationMs ?? null,
    consecutiveErrors: st.consecutiveErrors ?? 0,
    consecutiveSkipped: st.consecutiveSkipped ?? 0,
    createdAtMs: job.createdAtMs,
    updatedAtMs: job.updatedAtMs,
  };
}

interface RawRunEntry {
  ts: number;
  status?: "ok" | "error" | "skipped";
  error?: string;
  summary?: string;
  durationMs?: number;
  sessionKey?: string;
  runId?: string;
}

export function toScheduledRunDTO(e: RawRunEntry): ScheduledRunDTO {
  return {
    ts: e.ts,
    status: e.status ?? null,
    error: e.error ?? null,
    summary: e.summary ?? null,
    durationMs: e.durationMs ?? null,
    sessionKey: e.sessionKey ?? null,
    runId: e.runId ?? null,
  };
}
