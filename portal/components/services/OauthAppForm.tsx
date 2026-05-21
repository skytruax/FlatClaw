"use client";

import { useState, useTransition } from "react";

/**
 * Inline form for configuring a tenant's OAuth client_id / client_secret /
 * redirect_uri for one service. Posts to PATCH /api/portal/services/<svc>/oauth-app.
 *
 * The secret is intentionally not pre-filled even when configured — the
 * server preserves the existing secret if the field is left blank, so the
 * UI never echoes the secret back to the operator.
 */
export function OauthAppForm({
  service,
  providerLabel,
  clientIdInitial,
  redirectUriInitial,
  configured,
}: {
  service: string;
  providerLabel: string;
  clientIdInitial: string;
  redirectUriInitial: string;
  configured: boolean;
}) {
  const [clientId, setClientId] = useState(clientIdInitial);
  const [redirectUri, setRedirectUri] = useState(redirectUriInitial);
  const [clientSecret, setClientSecret] = useState("");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    startTransition(async () => {
      const res = await fetch(`/api/portal/services/${service}/oauth-app`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          redirectUri: redirectUri.trim(),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setMsg(
        clientSecret.trim()
          ? `${providerLabel} OAuth app saved (client_id + secret rotated).`
          : `${providerLabel} OAuth app updated (existing secret preserved).`,
      );
      setClientSecret("");
    });
  };

  const onDelete = async () => {
    if (
      !window.confirm(
        `Delete the ${providerLabel} OAuth app config? Users will no longer be able to connect a new account until you reconfigure. Existing connected accounts keep working until their refresh token is revoked.`,
      )
    )
      return;
    setMsg(null);
    setErr(null);
    startTransition(async () => {
      const res = await fetch(`/api/portal/services/${service}/oauth-app`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setClientId("");
      setRedirectUri("");
      setClientSecret("");
      setMsg(`${providerLabel} OAuth app config cleared.`);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1">
        <label className="block text-[11px] text-[hsl(var(--fc-fg-muted))]">
          Client ID
          <span className="text-red-500"> *</span>
        </label>
        <input
          type="text"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="613493443915-…apps.googleusercontent.com"
          required
          autoComplete="off"
          className="w-full rounded bg-[hsl(var(--fc-bg-primary))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] px-2 py-1 text-sm font-mono"
        />
      </div>
      <div className="space-y-1">
        <label className="block text-[11px] text-[hsl(var(--fc-fg-muted))]">
          Client Secret
          {configured ? (
            <span className="ml-1 text-[hsl(var(--fc-fg-muted))]">
              (leave blank to keep existing)
            </span>
          ) : (
            <span className="text-red-500"> *</span>
          )}
        </label>
        <input
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder={configured ? "•••••••• (already set)" : "GOCSPX-…"}
          autoComplete="new-password"
          required={!configured}
          className="w-full rounded bg-[hsl(var(--fc-bg-primary))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] px-2 py-1 text-sm font-mono"
        />
      </div>
      <div className="space-y-1">
        <label className="block text-[11px] text-[hsl(var(--fc-fg-muted))]">
          Redirect URI
          <span className="text-red-500"> *</span>
        </label>
        <input
          type="url"
          value={redirectUri}
          onChange={(e) => setRedirectUri(e.target.value)}
          placeholder={`http://localhost:3000/api/portal/oauth/${service}/callback`}
          required
          autoComplete="off"
          className="w-full rounded bg-[hsl(var(--fc-bg-primary))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] px-2 py-1 text-sm font-mono"
        />
        <p className="text-[10px] text-[hsl(var(--fc-fg-muted))]">
          Must match exactly what the provider has registered. Provider URL
          rewrites/trailing slashes count.
        </p>
      </div>

      {msg && (
        <div className="rounded bg-[hsl(var(--brand-accent))/0.12] text-[hsl(var(--brand-accent))] text-xs px-3 py-2">
          ✓ {msg}
        </div>
      )}
      {err && (
        <div className="rounded bg-red-50 text-red-700 text-xs px-3 py-2">
          ⚠ {err}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          {configured && (
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="text-xs text-red-600 hover:underline disabled:opacity-50"
            >
              Clear config
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-[hsl(var(--brand-accent))] px-3 py-1 text-xs font-semibold text-[hsl(var(--brand-accent-fg))] hover:bg-[hsl(var(--brand-primary))] disabled:opacity-70"
        >
          {pending
            ? "Saving…"
            : configured
              ? "Update"
              : `Configure ${providerLabel}`}
        </button>
      </div>
    </form>
  );
}
