"use client";

import { useEffect, useState, useTransition } from "react";
import Switch from "./Switch";

/**
 * Generic per-user services panel. Renders one card per registered managed
 * MCP service, with a plugin-driven credential form (fields come from the
 * service descriptor in `lib/openclaw/services/<svc>.plugin.ts`).
 *
 * The admin (or the user themselves, where allowed) connects / rotates /
 * disconnects each service through the same UX, no per-service component
 * code.
 */

type FieldType = "text" | "secret" | "url" | "number" | "boolean";

interface FieldSpec {
  name: string;
  label: string;
  placeholder?: string;
  type: FieldType;
  required?: boolean;
  defaultValue?: string | number | boolean;
  help?: string;
}

interface ServiceStatus {
  connected: boolean;
  identity?: string | null;
  updatedAt?: number | null;
  lastUsedAt?: number | null;
  meta?: Record<string, unknown> | null;
}

type ServiceAuth =
  | { kind: "form"; fields: FieldSpec[] }
  | {
      kind: "oauth";
      provider: string;
      providerLabel: string;
      scopes: string[];
      appConfigured: boolean;
    };

interface ServiceDescriptor {
  service: string;
  label: string;
  emoji: string | null;
  description: string;
  auth: ServiceAuth;
  status: ServiceStatus;
  tenantEnabled: boolean;
}

export default function ServicesPanel({ userId }: { userId: string }) {
  const [services, setServices] = useState<ServiceDescriptor[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const res = await fetch(`/api/portal/users/${userId}/services`, {
      cache: "no-store",
    });
    const data = (await res.json()) as
      | { ok: true; isAdmin: boolean; services: ServiceDescriptor[] }
      | { error: string };
    if ("error" in data) setError(data.error);
    else {
      setServices(data.services);
      setIsAdmin(data.isAdmin);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (error) {
    return (
      <div className="rounded bg-red-50 text-red-700 text-xs px-3 py-2">
        Failed to load services: {error}
      </div>
    );
  }
  if (!services) {
    return (
      <div className="text-xs text-[hsl(var(--fc-fg-muted))]">
        Loading services…
      </div>
    );
  }
  if (services.length === 0) {
    return (
      <div className="text-xs text-[hsl(var(--fc-fg-muted))]">
        No services registered. Add a plugin in{" "}
        <code className="font-mono">portal/lib/openclaw/services/</code>.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {services.map((s) => (
        <ServiceCard
          key={s.service}
          userId={userId}
          descriptor={s}
          isAdmin={isAdmin}
          onChanged={refresh}
        />
      ))}
    </div>
  );
}

function ServiceCard({
  userId,
  descriptor,
  isAdmin,
  onChanged,
}: {
  userId: string;
  descriptor: ServiceDescriptor;
  isAdmin: boolean;
  onChanged: () => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [pending, startTransition] = useTransition();
  const [opError, setOpError] = useState<string | null>(null);

  const submitConnect = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (descriptor.auth.kind !== "form") return;
    setOpError(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {};
    for (const f of descriptor.auth.fields) {
      const raw = fd.get(f.name);
      if (f.type === "boolean") {
        payload[f.name] = raw === "on" || raw === "true";
      } else if (raw !== null && raw !== "") {
        payload[f.name] = raw;
      }
    }
    startTransition(async () => {
      const res = await fetch(
        `/api/portal/users/${userId}/services/${descriptor.service}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        provisionError?: string | null;
        note?: string | null;
      };
      if (!res.ok || !data.ok) {
        setOpError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // Even on `ok:true` the provision step can have failed (credentials
      // saved but per-user MCP not registered). Surface that as an error
      // so the admin doesn't think they're done.
      if (data.provisionError) {
        setOpError(data.note ?? data.provisionError);
        await onChanged();
        return;
      }
      setShowForm(false);
      await onChanged();
    });
  };

  const disconnect = async () => {
    setOpError(null);
    startTransition(async () => {
      const res = await fetch(
        `/api/portal/users/${userId}/services/${descriptor.service}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setOpError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      await onChanged();
    });
  };

  const toggleTenant = async (enabled: boolean) => {
    setOpError(null);
    startTransition(async () => {
      const res = await fetch(
        `/api/portal/services/${descriptor.service}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setOpError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      await onChanged();
    });
  };

  const credentialsSavedNotProvisioned =
    descriptor.status.connected && !descriptor.tenantEnabled;

  return (
    <div className="rounded-lg bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-[hsl(var(--fc-bg-tertiary))] flex items-center justify-center text-base shrink-0">
          {descriptor.emoji ?? "🔌"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-medium">{descriptor.label}</h3>
            <span className="text-[10px] font-mono text-[hsl(var(--fc-fg-muted))]">
              {descriptor.service}
            </span>
            {!isAdmin && (
              <span
                className={
                  "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded " +
                  (descriptor.tenantEnabled
                    ? "text-[hsl(var(--brand-accent))] bg-[hsl(var(--brand-accent))/0.12]"
                    : "text-[hsl(var(--fc-fg-muted))] bg-[hsl(var(--fc-bg-tertiary))]")
                }
              >
                {descriptor.tenantEnabled ? "tenant on" : "tenant off"}
              </span>
            )}
          </div>
          <p className="text-xs text-[hsl(var(--fc-fg-muted))] mt-0.5">
            {descriptor.description}
          </p>
          {descriptor.status.connected ? (
            <div className="text-xs mt-1.5">
              <span
                className={
                  descriptor.tenantEnabled
                    ? "text-[hsl(var(--brand-accent))]"
                    : "text-amber-600"
                }
              >
                ●
              </span>{" "}
              <span className="font-medium">
                {descriptor.tenantEnabled ? "Connected" : "Credentials saved"}
              </span>
              {descriptor.status.identity && (
                <span className="text-[hsl(var(--fc-fg-muted))]">
                  {" "}
                  as <span className="font-mono">{descriptor.status.identity}</span>
                </span>
              )}
              {credentialsSavedNotProvisioned && (
                <div className="text-[10px] text-amber-600 mt-0.5">
                  Awaiting admin enable — once a tenant admin enables this
                  service, the per-user MCP will be provisioned automatically.
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs mt-1.5 text-[hsl(var(--fc-fg-muted))]">
              ○ Not connected
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 shrink-0 items-end">
          {isAdmin && (
            <div
              className="flex items-center gap-1.5"
              title={
                descriptor.tenantEnabled
                  ? "On: provisions a per-user MCP for every user with creds saved. Toggle off to deprovision all of them."
                  : "Off: nobody sees this service yet. Toggle on once you're ready to expose it tenant-wide."
              }
            >
              <span className="text-[10px] uppercase tracking-wide text-[hsl(var(--fc-fg-muted))]">
                tenant
              </span>
              <Switch
                checked={descriptor.tenantEnabled}
                onChange={(next) => toggleTenant(next)}
                disabled={pending}
              />
            </div>
          )}
          {descriptor.status.connected ? (
            <>
              {descriptor.auth.kind === "form" ? (
                <button
                  type="button"
                  onClick={() => setShowForm((v) => !v)}
                  disabled={pending}
                  className="text-xs text-[hsl(var(--fc-fg-secondary))] hover:underline disabled:opacity-50"
                >
                  {showForm
                    ? "Cancel"
                    : // Form services with a `secret` field use "Rotate" since
                      // the action is replacing a credential. Form services
                      // without a secret (where the "credential" is just config
                      // like a role) use "Edit" so an admin can change it.
                      descriptor.auth.fields.some((f) => f.type === "secret")
                      ? "Rotate"
                      : "Edit"}
                </button>
              ) : (
                <a
                  href={`/api/portal/users/${userId}/services/${descriptor.service}/oauth/start`}
                  className="text-xs text-[hsl(var(--fc-fg-secondary))] hover:underline"
                >
                  Re-authorize
                </a>
              )}
              <button
                type="button"
                onClick={disconnect}
                disabled={pending}
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                Disconnect
              </button>
            </>
          ) : descriptor.auth.kind === "form" ? (
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              disabled={pending}
              className="rounded bg-[hsl(var(--brand-accent))] px-3 py-1 text-xs font-semibold text-[hsl(var(--brand-accent-fg))] hover:bg-[hsl(var(--brand-primary))] disabled:opacity-70"
            >
              {showForm ? "Cancel" : "Connect"}
            </button>
          ) : descriptor.auth.appConfigured ? (
            <a
              href={`/api/portal/users/${userId}/services/${descriptor.service}/oauth/start`}
              className="rounded bg-[hsl(var(--brand-accent))] px-3 py-1 text-xs font-semibold text-[hsl(var(--brand-accent-fg))] hover:bg-[hsl(var(--brand-primary))] inline-block"
            >
              Connect with {descriptor.auth.providerLabel}
            </a>
          ) : (
            <span
              className="text-[10px] text-amber-600 max-w-[10rem] text-right"
              title={`Tenant admin must configure the ${descriptor.auth.providerLabel} OAuth app at /admin/services/${descriptor.service}/oauth-app first.`}
            >
              {descriptor.auth.providerLabel} OAuth app not configured
            </span>
          )}
        </div>
      </div>

      {showForm && descriptor.auth.kind === "form" && (
        <form
          onSubmit={submitConnect}
          className="mt-3 pt-3 border-t border-[hsl(var(--fc-bg-tertiary))] space-y-3"
        >
          {descriptor.auth.fields.map((f) => (
            <div key={f.name} className="space-y-1">
              <label className="block text-[11px] text-[hsl(var(--fc-fg-muted))]">
                {f.label}
                {f.required !== false && (
                  <span className="text-red-500"> *</span>
                )}
              </label>
              {f.type === "boolean" ? (
                <label className="inline-flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    name={f.name}
                    defaultChecked={
                      // Prefer the currently-saved value (status.meta) over the
                      // plugin's static default, so editing a connected service
                      // pre-fills with what's in the vault rather than the
                      // factory default — important for role-style configs where
                      // the saved role must show through instead of the default.
                      typeof descriptor.status.meta?.[f.name] === "boolean"
                        ? (descriptor.status.meta?.[f.name] as boolean)
                        : typeof f.defaultValue === "boolean"
                          ? f.defaultValue
                          : true
                    }
                    className="h-3.5 w-3.5 accent-[hsl(var(--brand-accent))]"
                  />
                  <span>{f.help ?? f.label}</span>
                </label>
              ) : (
                <input
                  name={f.name}
                  type={
                    f.type === "secret"
                      ? "password"
                      : f.type === "number"
                        ? "number"
                        : "text"
                  }
                  placeholder={f.placeholder}
                  defaultValue={(() => {
                    // Same precedence as above — pre-fill the saved value when
                    // it exists; fall back to the plugin's static default. Skip
                    // for `secret` fields (we never echo a stored secret back
                    // into a form input).
                    const meta = descriptor.status.meta?.[f.name];
                    if (f.type !== "secret" && meta !== null && meta !== undefined) {
                      return String(meta);
                    }
                    return f.defaultValue !== undefined
                      ? String(f.defaultValue)
                      : undefined;
                  })()}
                  required={f.required !== false}
                  autoComplete={f.type === "secret" ? "new-password" : "off"}
                  className="w-full rounded bg-[hsl(var(--fc-bg-primary))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] px-2 py-1 text-sm font-mono"
                />
              )}
              {f.help && f.type !== "boolean" && (
                <p className="text-[10px] text-[hsl(var(--fc-fg-muted))]">
                  {f.help}
                </p>
              )}
            </div>
          ))}

          {opError && (
            <div className="rounded bg-red-50 text-red-700 text-xs px-3 py-2">
              {opError}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-[hsl(var(--brand-accent))] px-3 py-1 text-xs font-semibold text-[hsl(var(--brand-accent-fg))] hover:bg-[hsl(var(--brand-primary))] disabled:opacity-70"
            >
              {pending
                ? "Saving…"
                : descriptor.status.connected
                  ? descriptor.auth.kind === "form" &&
                    descriptor.auth.fields.some((f) => f.type === "secret")
                    ? "Rotate"
                    : "Save"
                  : "Save credentials"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
