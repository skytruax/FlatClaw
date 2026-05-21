import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import "@/lib/openclaw/services";
import { listManagedMcpServices } from "@/lib/openclaw/managed-mcp";
import { readOauthAppStatus } from "@/lib/credentials/oauth-app";
import { OauthAppForm } from "@/components/services/OauthAppForm";

export const dynamic = "force-dynamic";

/**
 * Tenant-level OAuth app configuration. One card per OAuth-kind plugin
 * (google today; slack/notion/jira/hubspot when those plugins land).
 *
 * The OAuth client_id / client_secret / redirect_uri must be configured
 * here before any user can hit the per-user "Connect with <provider>"
 * button — without it, the OAuth start route 412s with "tenant OAuth
 * app for '<svc>' not configured."
 */
export default async function OauthAppsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/me/chat");

  const services = listManagedMcpServices().filter(
    (s) => s.auth.kind === "oauth",
  );
  const tiles = await Promise.all(
    services.map(async (svc) => {
      const status = await readOauthAppStatus(svc.service);
      // svc.auth.kind === "oauth" was just filtered above.
      const oauthAuth = svc.auth as Extract<
        typeof svc.auth,
        { kind: "oauth" }
      >;
      return {
        service: svc.service,
        label: svc.label,
        emoji: svc.emoji ?? null,
        description: svc.description,
        provider: oauthAuth.provider,
        providerLabel: oauthAuth.providerLabel,
        scopes: oauthAuth.scopes,
        status,
      };
    }),
  );

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">OAuth applications</h1>
        <p className="text-sm text-[hsl(var(--fc-fg-muted))] mt-1">
          Tenant-level OAuth client config for every service that uses an
          OAuth flow. Each row is one provider's <code>client_id</code>,{" "}
          <code>client_secret</code>, and authorized <code>redirect_uri</code>.
          Configure these once per tenant; users then connect their own
          accounts via the per-user Service connections page.
        </p>
      </div>

      {tiles.length === 0 ? (
        <div className="rounded-lg bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-4 text-sm text-[hsl(var(--fc-fg-muted))]">
          No OAuth-based services registered yet. Form-auth services (cPanel,
          CalDav) don&apos;t need tenant-level OAuth app configuration — their
          credentials are entered per user.
        </div>
      ) : (
        tiles.map((t) => (
          <div
            key={t.service}
            className="rounded-lg bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-4"
          >
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-[hsl(var(--fc-bg-tertiary))] flex items-center justify-center text-base shrink-0">
                {t.emoji ?? "🔐"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-medium">{t.label}</h2>
                  <span className="text-[10px] font-mono text-[hsl(var(--fc-fg-muted))]">
                    {t.service}
                  </span>
                  {t.status.configured ? (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded text-[hsl(var(--brand-accent))] bg-[hsl(var(--brand-accent))/0.12]">
                      configured
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded text-amber-600 bg-amber-50">
                      not configured
                    </span>
                  )}
                </div>
                <p className="text-xs text-[hsl(var(--fc-fg-muted))] mt-0.5">
                  {t.description}
                </p>
                <details className="text-[10.5px] mt-2 text-[hsl(var(--fc-fg-muted))]">
                  <summary className="cursor-pointer hover:text-[hsl(var(--fc-fg-secondary))]">
                    Required scopes ({t.scopes.length})
                  </summary>
                  <ul className="mt-1 ml-3 font-mono text-[10px] space-y-0.5 text-[hsl(var(--fc-fg-secondary))]">
                    {t.scopes.map((s) => (
                      <li key={s} className="break-all">
                        {s}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-[hsl(var(--fc-bg-tertiary))]">
              <OauthAppForm
                service={t.service}
                providerLabel={t.providerLabel}
                clientIdInitial={t.status.clientId ?? ""}
                redirectUriInitial={t.status.redirectUri ?? ""}
                configured={t.status.configured}
              />
            </div>
          </div>
        ))
      )}

      <div className="rounded-lg bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-4 text-xs text-[hsl(var(--fc-fg-muted))]">
        <h3 className="text-sm font-medium text-[hsl(var(--fc-fg-secondary))] mb-1">
          How redirect URIs work
        </h3>
        <p>
          The redirect URI you configure here must match exactly what the
          provider has registered for this OAuth client. The portal&apos;s
          callback path follows the pattern{" "}
          <code className="font-mono">
            {"{portal-base}"}/api/portal/oauth/{"{service}"}/callback
          </code>
          . For Google specifically this is{" "}
          <code className="font-mono">
            http://localhost:3000/api/portal/oauth/google/callback
          </code>{" "}
          on a dev box and{" "}
          <code className="font-mono">
            https://flatclaw.{"{tenant}"}.app/api/portal/oauth/google/callback
          </code>{" "}
          on a deployed tenant. Update both Google Cloud Console and this
          form to match.
        </p>
      </div>
    </div>
  );
}
