/**
 * Shared DTO shapes for the portal's scheduled-tasks surface. Isomorphic —
 * imported by both the API routes and the client components. These are the
 * portal's *projection* of openclaw's `CronJob` / `CronRunLogEntry`; the
 * gateway remains the source of truth.
 */
import type { CronScheduleDTO, FrequencyInput } from "./cron-expr";

export type { CronScheduleDTO, FrequencyInput };

export type ThinkingLevel = "off" | "low" | "medium" | "high";

export interface ScheduledTaskDTO {
  /** openclaw cron job id. */
  id: string;
  agentId: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  /** `deleteAfterRun` — true for one-shot "at" jobs; the job removes itself after it fires. */
  oneOff: boolean;
  schedule: CronScheduleDTO;
  /** Plain-English restatement of `schedule` (e.g. "Every weekday at 8:30 AM"). */
  scheduleSummary: string;
  /** Picker state reverse-derived from `schedule`, for the edit form. */
  frequency: FrequencyInput;
  /** The agent-turn instruction this task runs (`payload.message`). */
  instruction: string;
  thinking: ThinkingLevel | string | null;
  /** True when `delivery.mode === "announce"` — posts a summary after each run. */
  announce: boolean;
  nextRunAtMs: number | null;
  lastRunAtMs: number | null;
  lastRunStatus: "ok" | "error" | "skipped" | null;
  lastError: string | null;
  lastDurationMs: number | null;
  consecutiveErrors: number;
  consecutiveSkipped: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ScheduledRunDTO {
  ts: number;
  status: "ok" | "error" | "skipped" | null;
  error: string | null;
  summary: string | null;
  durationMs: number | null;
  sessionKey: string | null;
  runId: string | null;
}

/** Body accepted by POST /api/portal/scheduled-tasks and (partially) PATCH. */
export interface CreateScheduledTaskBody {
  /** Admin only: act on behalf of this user; ignored for non-admins. */
  targetUserId?: string;
  name: string;
  description?: string;
  instruction: string;
  frequency: FrequencyInput;
  /** IANA timezone (e.g. "America/New_York"); used for cron-kind schedules. */
  timezone?: string;
  thinking?: ThinkingLevel;
  announce?: boolean;
}

export type UpdateScheduledTaskBody = Partial<
  Omit<CreateScheduledTaskBody, "frequency">
> & {
  targetUserId?: string;
  /** Toggle paused/active. */
  enabled?: boolean;
  /** Reschedule — when present, replaces the job's schedule wholesale. */
  frequency?: FrequencyInput;
};
