"use client";

import { useState, useTransition } from "react";
import Switch from "./Switch";

/**
 * Admin Settings → service-connection visibility. One row per registered
 * managed MCP service with a "Visible" switch. Hiding a service removes its
 * card from the per-user connections panel so a demo stays simple — it does
 * NOT disable or deprovision the service (that's the per-tenant toggle on the
 * user page). Writes the UI-only `hidden` flag via PATCH.
 */

interface SvcVisibility {
  service: string;
  label: string;
  emoji: string | null;
  description: string;
  hidden: boolean;
  enabled: boolean;
}

export default function ServiceVisibilityPanel({
  initial,
}: {
  initial: SvcVisibility[];
}) {
  const [services, setServices] = useState<SvcVisibility[]>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const setVisible = (service: string, visible: boolean) => {
    setError(null);
    // optimistic
    setServices((prev) =>
      prev.map((s) => (s.service === service ? { ...s, hidden: !visible } : s)),
    );
    startTransition(async () => {
      const res = await fetch(`/api/portal/services/${service}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: !visible }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? `HTTP ${res.status}`);
        // revert
        setServices((prev) =>
          prev.map((s) =>
            s.service === service ? { ...s, hidden: visible } : s,
          ),
        );
      }
    });
  };

  const hiddenCount = services.filter((s) => s.hidden).length;

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded bg-red-50 text-red-700 text-xs px-3 py-2">
          {error}
        </div>
      )}
      {services.map((s) => {
        const visible = !s.hidden;
        return (
          <div
            key={s.service}
            className={
              "rounded-lg ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-4 transition-opacity " +
              (visible
                ? "bg-[hsl(var(--fc-bg-surface))]"
                : "bg-[hsl(var(--fc-bg-surface))] opacity-60")
            }
          >
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-[hsl(var(--fc-bg-tertiary))] flex items-center justify-center text-base shrink-0">
                {s.emoji ?? "🔌"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-medium">{s.label}</h3>
                  <span className="text-[10px] font-mono text-[hsl(var(--fc-fg-muted))]">
                    {s.service}
                  </span>
                  <span
                    className={
                      "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded " +
                      (s.enabled
                        ? "text-[hsl(var(--brand-accent))] bg-[hsl(var(--brand-accent))/0.12]"
                        : "text-[hsl(var(--fc-fg-muted))] bg-[hsl(var(--fc-bg-tertiary))]")
                    }
                  >
                    {s.enabled ? "tenant on" : "tenant off"}
                  </span>
                  {s.hidden && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded text-amber-600 bg-amber-500/10">
                      hidden
                    </span>
                  )}
                </div>
                <p className="text-xs text-[hsl(var(--fc-fg-muted))] mt-0.5 line-clamp-2">
                  {s.description}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-[10px] uppercase tracking-wide text-[hsl(var(--fc-fg-muted))]">
                  {visible ? "visible" : "hidden"}
                </span>
                <Switch
                  checked={visible}
                  onChange={(next) => setVisible(s.service, next)}
                  disabled={pending}
                  size="md"
                />
              </div>
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-[hsl(var(--fc-fg-muted))] pt-1">
        {hiddenCount === 0
          ? "All services visible on the connections panel."
          : `${hiddenCount} service${hiddenCount === 1 ? "" : "s"} hidden from the connections panel. Hiding is visual only — it does not disable or deprovision anything (use the per-tenant toggle on a user's page for that).`}
      </p>
    </div>
  );
}
