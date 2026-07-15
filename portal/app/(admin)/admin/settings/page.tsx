import { requireAdmin } from "@/lib/auth/guards";
import "@/lib/openclaw/services"; // registers plugins
import {
  listManagedMcpServices,
  isServiceEnabled,
  getHiddenServices,
} from "@/lib/openclaw/managed-mcp";
import ServiceVisibilityPanel from "@/components/services/ServiceVisibilityPanel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SettingsPage() {
  await requireAdmin();

  const hidden = await getHiddenServices();
  const svcs = listManagedMcpServices();
  const initial = await Promise.all(
    svcs.map(async (s) => ({
      service: s.service,
      label: s.label,
      emoji: s.emoji ?? null,
      description: s.description,
      hidden: hidden.has(s.service),
      enabled: await isServiceEnabled(s.service),
    })),
  );

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-[hsl(var(--fc-fg-muted))] mt-1">
          Show or hide service connections to simplify demos. Hiding a service
          only removes its card from the per-user connections panel — it does
          not disable or deprovision anything. The per-tenant enable/disable
          stays on each user&apos;s page.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-[hsl(var(--fc-fg-secondary))]">
          Service connection visibility
        </h2>
        <ServiceVisibilityPanel initial={initial} />
      </section>
    </div>
  );
}
