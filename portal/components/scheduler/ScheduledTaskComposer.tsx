"use client";

import { useState } from "react";
import {
  describeFrequencyInput,
  type FrequencyInput,
} from "@/lib/scheduler/cron-expr";
import type {
  CreateScheduledTaskBody,
  ScheduledTaskDTO,
  ThinkingLevel,
} from "@/lib/scheduler/contract";
import FrequencyPicker, { defaultForKind } from "./FrequencyPicker";

export interface ComposerSubmit {
  name: string;
  description: string;
  instruction: string;
  frequency: FrequencyInput;
  timezone: string;
  thinking: ThinkingLevel;
  announce: boolean;
}

/**
 * Create / edit form for a scheduled task — a centered modal. Owns its draft
 * state; calls `onSubmit` with the assembled body. The parent decides POST
 * vs PATCH based on whether `editing` was passed.
 */
export default function ScheduledTaskComposer({
  editing,
  timezone,
  onClose,
  onSubmit,
}: {
  editing: ScheduledTaskDTO | null;
  timezone: string;
  onClose: () => void;
  onSubmit: (body: ComposerSubmit) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [instruction, setInstruction] = useState(editing?.instruction ?? "");
  // Description ("optional notes") isn't surfaced as its own field in v1 —
  // the instruction box carries the intent. Preserved on edit if it exists.
  const description = editing?.description ?? "";
  const [frequency, setFrequency] = useState<FrequencyInput>(
    editing?.frequency ?? defaultForKind("daily"),
  );
  const [thinking, setThinking] = useState<ThinkingLevel>(
    (editing?.thinking as ThinkingLevel) ?? "medium",
  );
  const [announce, setAnnounce] = useState(editing?.announce ?? false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = describeFrequencyInput(frequency, timezone);
  const canSubmit = name.trim().length > 0 && instruction.trim().length > 0 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const res = await onSubmit({
      name: name.trim(),
      description: description.trim(),
      instruction: instruction.trim(),
      frequency,
      timezone,
      thinking,
      announce,
    });
    setSubmitting(false);
    if (!res.ok) setError(res.error);
    else onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="mt-8 w-full max-w-xl rounded-lg bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[hsl(var(--fc-bg-tertiary))] px-5 py-3">
          <h3 className="text-sm font-semibold">
            {editing ? "Edit scheduled task" : "New scheduled task"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[hsl(var(--fc-fg-muted))] hover:text-[hsl(var(--fc-fg-primary))]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm">
          <div>
            <label className="mb-1 block text-[hsl(var(--fc-fg-secondary))]">Task name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Weekly client recap"
              className="w-full rounded border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-primary))] px-2.5 py-1.5"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-[hsl(var(--fc-fg-secondary))]">
              What should the agent do?
            </label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={4}
              placeholder="Draft the weekly client recap covering last week's activity and key emails, then email it to me."
              className="w-full rounded border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-primary))] px-2.5 py-1.5 leading-relaxed"
            />
            <p className="mt-1 text-[11px] text-[hsl(var(--fc-fg-muted))]">
              Same as a chat message — plain language, no special syntax.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-[hsl(var(--fc-fg-secondary))]">Frequency</label>
            <FrequencyPicker value={frequency} onChange={setFrequency} timezone={timezone} />
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-[hsl(var(--brand-accent))] hover:underline"
            >
              {showAdvanced ? "▾ Advanced" : "▸ Advanced"}
            </button>
            {showAdvanced && (
              <div className="mt-2 space-y-2 rounded border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-soft))] p-3">
                <label className="flex items-center gap-2">
                  <span className="text-[hsl(var(--fc-fg-secondary))]">Thinking depth</span>
                  <select
                    value={thinking}
                    onChange={(e) => setThinking(e.target.value as ThinkingLevel)}
                    className="rounded border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-surface))] px-2 py-1"
                  >
                    <option value="off">off</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={announce}
                    onChange={(e) => setAnnounce(e.target.checked)}
                    className="accent-[hsl(var(--brand-accent))]"
                  />
                  <span className="text-[hsl(var(--fc-fg-secondary))]">
                    Post a short summary to my main chat when it runs
                  </span>
                </label>
              </div>
            )}
          </div>

          <div className="rounded bg-[hsl(var(--fc-bg-soft))] px-3 py-2 text-[hsl(var(--fc-fg-secondary))]">
            This task will: <span className="font-medium">{preview}</span>
          </div>

          {error && (
            <div className="rounded bg-red-50 px-3 py-2 text-red-700">
              <span className="font-semibold">Couldn&apos;t save:</span> {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[hsl(var(--fc-bg-tertiary))] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-[hsl(var(--fc-fg-secondary))] hover:bg-[hsl(var(--fc-bg-soft))]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded bg-[hsl(var(--brand-accent))] px-4 py-1.5 text-sm font-semibold text-[hsl(var(--brand-accent-fg))] hover:bg-[hsl(var(--brand-primary))] disabled:opacity-50"
          >
            {submitting ? "Saving…" : editing ? "Save changes" : "Schedule task"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Assemble the API body for create/edit from the composer submit payload. */
export function composerToBody(
  s: ComposerSubmit,
  targetUserId: string | undefined,
): CreateScheduledTaskBody {
  return {
    ...(targetUserId ? { targetUserId } : {}),
    name: s.name,
    description: s.description || undefined,
    instruction: s.instruction,
    frequency: s.frequency,
    timezone: s.timezone,
    thinking: s.thinking,
    announce: s.announce,
  };
}
