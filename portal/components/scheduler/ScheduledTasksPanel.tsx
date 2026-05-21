"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScheduledTaskDTO } from "@/lib/scheduler/contract";
import ScheduledTasksList from "./ScheduledTasksList";
import ScheduledTaskComposer, {
  composerToBody,
  type ComposerSubmit,
} from "./ScheduledTaskComposer";
import RunHistoryDrawer from "./RunHistoryDrawer";

/**
 * Top-level scheduled-tasks surface. Used both on `/me/scheduled` (the user's
 * own tasks) and inside the admin user-detail page (acting on a target user
 * via `targetUserId`). Stateless over openclaw's cron subsystem — every
 * mutation hits the gateway and re-pulls the list.
 */
export default function ScheduledTasksPanel({
  targetUserId,
  chatLinkBase,
}: {
  /** Admin-only: scope all calls to this user's agent. Omit for self. */
  targetUserId?: string;
  /** Base path for "open session" links from the run-history drawer. */
  chatLinkBase: string;
}) {
  const [tasks, setTasks] = useState<ScheduledTaskDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [composer, setComposer] = useState<
    { open: true; editing: ScheduledTaskDTO | null } | { open: false }
  >({ open: false });
  const [historyTask, setHistoryTask] = useState<ScheduledTaskDTO | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);

  const qsBase = useMemo(() => {
    const qs = new URLSearchParams();
    if (targetUserId) qs.set("targetUserId", targetUserId);
    return qs.toString();
  }, [targetUserId]);

  const fetchTasks = useCallback(async (): Promise<
    { tasks: ScheduledTaskDTO[] } | { error: string }
  > => {
    try {
      const r = await fetch(
        `/api/portal/scheduled-tasks${qsBase ? `?${qsBase}` : ""}`,
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { error: j.error ?? `HTTP ${r.status}` };
      return { tasks: j.tasks ?? [] };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [qsBase]);

  const applyFetchResult = useCallback(
    (res: { tasks: ScheduledTaskDTO[] } | { error: string }) => {
      if ("error" in res) setError(res.error);
      else {
        setError(null);
        setTasks(res.tasks);
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    applyFetchResult(await fetchTasks());
  }, [fetchTasks, applyFetchResult]);

  useEffect(() => {
    let cancelled = false;
    fetchTasks().then((res) => {
      if (!cancelled) applyFetchResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchTasks, applyFetchResult]);

  function withTargetBody<T extends Record<string, unknown>>(body: T): T & { targetUserId?: string } {
    return targetUserId ? { ...body, targetUserId } : body;
  }

  const submitComposer = useCallback(
    async (s: ComposerSubmit): Promise<{ ok: true } | { ok: false; error: string }> => {
      const editing = composer.open ? composer.editing : null;
      const body = composerToBody(s, targetUserId);
      try {
        const r = await fetch(
          editing
            ? `/api/portal/scheduled-tasks/${encodeURIComponent(editing.id)}`
            : "/api/portal/scheduled-tasks",
          {
            method: editing ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return { ok: false, error: j.error ?? `HTTP ${r.status}` };
        await refresh();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    [composer, refresh, targetUserId],
  );

  async function runMutation(
    task: ScheduledTaskDTO,
    op: () => Promise<Response>,
  ) {
    setBusyId(task.id);
    setActionError(null);
    try {
      const r = await op();
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setActionError(j.error ?? `HTTP ${r.status}`);
      else if (j.reason === "already-running")
        setActionError(`"${task.name}" is already running.`);
      else if (j.ran === false && j.reason)
        setActionError(`"${task.name}" not run: ${j.reason}.`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
      await refresh();
    }
  }

  const onRunNow = (task: ScheduledTaskDTO) =>
    runMutation(task, () =>
      fetch(`/api/portal/scheduled-tasks/${encodeURIComponent(task.id)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withTargetBody({})),
      }),
    );

  const onTogglePause = (task: ScheduledTaskDTO) =>
    runMutation(task, () =>
      fetch(`/api/portal/scheduled-tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withTargetBody({ enabled: !task.enabled })),
      }),
    );

  const onDelete = (task: ScheduledTaskDTO) => {
    if (!confirm(`Delete scheduled task "${task.name}"? This can't be undone.`)) return;
    return runMutation(task, () =>
      fetch(
        `/api/portal/scheduled-tasks/${encodeURIComponent(task.id)}${
          qsBase ? `?${qsBase}` : ""
        }`,
        { method: "DELETE" },
      ),
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-[hsl(var(--fc-fg-muted))]">
          Runs the agent on a schedule — backed by the gateway&apos;s cron engine. Each run
          executes in its own session.
        </p>
        <button
          type="button"
          onClick={() => setComposer({ open: true, editing: null })}
          className="shrink-0 rounded bg-[hsl(var(--brand-accent))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--brand-accent-fg))] hover:bg-[hsl(var(--brand-primary))]"
        >
          + New scheduled task
        </button>
      </div>

      {error && (
        <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">
          Couldn&apos;t load scheduled tasks: {error}
        </div>
      )}
      {actionError && (
        <div className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">{actionError}</div>
      )}

      {tasks === null ? (
        <div className="rounded-lg border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-soft))] px-4 py-6 text-center text-sm text-[hsl(var(--fc-fg-muted))]">
          Loading…
        </div>
      ) : (
        <ScheduledTasksList
          tasks={tasks}
          busyId={busyId}
          onRunNow={onRunNow}
          onEdit={(task) => setComposer({ open: true, editing: task })}
          onTogglePause={onTogglePause}
          onDelete={onDelete}
          onViewHistory={(task) => setHistoryTask(task)}
        />
      )}

      {composer.open && (
        <ScheduledTaskComposer
          editing={composer.editing}
          timezone={timezone}
          onClose={() => setComposer({ open: false })}
          onSubmit={submitComposer}
        />
      )}

      {historyTask && (
        <RunHistoryDrawer
          task={historyTask}
          targetUserId={targetUserId}
          chatLinkBase={chatLinkBase}
          onClose={() => setHistoryTask(null)}
        />
      )}
    </div>
  );
}
