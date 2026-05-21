"use client";

import { useState, useTransition } from "react";

/**
 * Per-user Tool Access. The whole panel is collapsed by default; expanding it
 * lazily loads every tool the user's agent can use — built-in/plugin groups
 * (from the gateway's live `tools.catalog`) and each connected MCP service's
 * tools (per-group). Unchecking a tool writes its id into the agent's native
 * `tools.deny`; the gateway filters denied tools from the roster before the
 * model sees them. No custom policy layer.
 */

interface ToolEntry {
  id: string;
  label: string;
  description?: string;
}
interface ToolSection {
  key: string;
  label: string;
  source: string; // core | plugin | <mcp service id>
  tools: ToolEntry[];
}
interface AccessResponse {
  ok: true;
  agentId: string;
  exists: boolean;
  denied: string[];
  sections: ToolSection[];
}

const SOURCE_BADGE: Record<string, string> = {
  core: "Built-in",
  plugin: "Connected",
};

export default function ToolAccessPanel({ userId }: { userId: string }) {
  const [data, setData] = useState<AccessResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [denied, setDenied] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const url = `/api/portal/users/${encodeURIComponent(userId)}/tool-access`;

  const load = async () => {
    setError(null);
    const res = await fetch(url, { cache: "no-store" });
    const json = (await res.json()) as AccessResponse | { error: string };
    if ("error" in json) {
      setError(json.error);
      setLoaded(true);
      return;
    }
    setData(json);
    setDenied(new Set(json.denied));
    setDirty(false);
    setLoaded(true);
  };

  // Lazy-load on first expand.
  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (e.currentTarget.open && !loaded) void load();
  };

  const allowed = (id: string) => !denied.has(id);
  const mutate = (fn: (s: Set<string>) => void) => {
    setDenied((prev) => {
      const next = new Set(prev);
      fn(next);
      return next;
    });
    setDirty(true);
  };
  const toggle = (id: string) => mutate((s) => (s.has(id) ? s.delete(id) : s.add(id)));
  const setSection = (sec: ToolSection, deny: boolean) =>
    mutate((s) => sec.tools.forEach((t) => (deny ? s.add(t.id) : s.delete(t.id))));

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ denied: Array.from(denied) }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setSavedAt(new Date().toISOString().slice(11, 19));
      setDirty(false);
      await load();
    });
  };

  return (
    <details
      onToggle={onToggle}
      className="group/panel rounded-lg bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))]"
    >
      <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer list-none">
        <span className="text-[hsl(var(--fc-fg-muted))] text-xs w-3 transition-transform group-open/panel:rotate-90">
          ▶
        </span>
        <h2 className="text-sm font-medium">Tool access</h2>
        {loaded && data && (
          <span className="text-[10px] text-[hsl(var(--fc-fg-muted))]">
            {denied.size > 0 ? `${denied.size} denied` : "all enabled"}
          </span>
        )}
        <span className="ml-auto text-[10px] text-[hsl(var(--fc-fg-muted))]">
          native OpenClaw tools.deny
        </span>
      </summary>

      <div className="border-t border-[hsl(var(--fc-bg-tertiary))]">
        {error ? (
          <div className="m-3 rounded bg-red-50 text-red-700 text-xs px-3 py-2">
            Tool access: {error}
          </div>
        ) : !loaded ? (
          <div className="px-4 py-3 text-xs text-[hsl(var(--fc-fg-muted))]">Loading…</div>
        ) : !data?.exists ? (
          <div className="px-4 py-3 text-xs text-[hsl(var(--fc-fg-muted))]">
            Agent <code className="font-mono">{data?.agentId}</code> isn&apos;t in the
            gateway roster yet — sync the agent first.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-[hsl(var(--fc-bg-tertiary))]">
              {dirty && (
                <span className="text-[10px] uppercase tracking-wide text-amber-700">unsaved</span>
              )}
              {savedAt && !dirty && (
                <span className="text-[10px] text-[hsl(var(--fc-fg-muted))]">saved {savedAt}</span>
              )}
              <button
                type="button"
                disabled={!dirty || pending}
                onClick={save}
                className="text-[11px] px-2.5 py-1 rounded bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] disabled:opacity-40"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
            <div className="divide-y divide-[hsl(var(--fc-bg-tertiary))]">
              {data.sections.map((sec) => {
                const deniedInSection = sec.tools.filter((t) => denied.has(t.id)).length;
                const enabled = sec.tools.length - deniedInSection;
                return (
                  <details key={sec.key} className="group/sec">
                    <summary className="flex items-center gap-2 px-4 py-2 cursor-pointer list-none hover:bg-[hsl(var(--fc-bg-soft))/0.6]">
                      <span className="text-[hsl(var(--fc-fg-muted))] text-[10px] w-3 transition-transform group-open/sec:rotate-90">
                        ▶
                      </span>
                      <span className="text-xs font-medium">{sec.label}</span>
                      <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-secondary))]">
                        {SOURCE_BADGE[sec.source] ?? sec.source}
                      </span>
                      <span className="ml-auto text-[10px] text-[hsl(var(--fc-fg-muted))]">
                        {enabled}/{sec.tools.length} on
                        {deniedInSection > 0 && (
                          <span className="text-amber-700"> · {deniedInSection} denied</span>
                        )}
                      </span>
                    </summary>
                    <div className="px-4 pb-3 pt-1">
                      <div className="flex gap-3 mb-2 text-[10px]">
                        <button
                          type="button"
                          onClick={() => setSection(sec, false)}
                          disabled={pending}
                          className="text-[hsl(var(--brand-primary))] hover:underline"
                        >
                          enable all
                        </button>
                        <button
                          type="button"
                          onClick={() => setSection(sec, true)}
                          disabled={pending}
                          className="text-[hsl(var(--fc-fg-muted))] hover:underline"
                        >
                          deny all
                        </button>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
                        {sec.tools.map((t) => (
                          <label
                            key={t.id}
                            className="flex items-start gap-2 cursor-pointer py-0.5"
                            title={t.description ?? t.id}
                          >
                            <input
                              type="checkbox"
                              checked={allowed(t.id)}
                              onChange={() => toggle(t.id)}
                              disabled={pending}
                              className="mt-0.5 h-3.5 w-3.5 accent-[hsl(var(--brand-accent))]"
                            />
                            <span className="text-[11px] font-mono leading-snug">{t.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </>
        )}
      </div>
    </details>
  );
}
