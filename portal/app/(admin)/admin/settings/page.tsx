import { requireAdmin } from "@/lib/auth/guards";
import "@/lib/openclaw/services"; // registers plugins
import {
  listManagedMcpServices,
  isServiceEnabled,
  getHiddenServices,
} from "@/lib/openclaw/managed-mcp";
import ServiceVisibilityPanel from "@/components/services/ServiceVisibilityPanel";
import { PendingButton } from "@/components/PendingButton";
import { gatewayMode } from "@/lib/gateways/paths";
import { listGatewayRecords } from "@/lib/gateways/registry";
import {
  clearInferenceSettings,
  readInferenceSettings,
  saveInferenceSettings,
} from "@/lib/settings/inference";
import { pushInferenceSettings } from "@/lib/settings/push-inference";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Save the inference endpoint and write it into every gateway. Replaces
 * editing PROD_INFERENCE_URL on the Northflank service and redeploying.
 */
async function saveInference(formData: FormData) {
  "use server";
  await requireAdmin();
  let status: "ok" | "fail" = "ok";
  let msg = "";
  try {
    const url = String(formData.get("url") ?? "").trim();
    const modelId = String(formData.get("modelId") ?? "").trim();
    const contextWindow = Number(String(formData.get("contextWindow") ?? "").trim());
    saveInferenceSettings({ url: url || null, modelId, contextWindow });
    const pushed = await pushInferenceSettings();
    msg = `${pushed.updated.length} gateway config(s) updated`;
    if (pushed.failed.length) {
      status = "fail";
      msg += `; ${pushed.failed.length} not reached: ${pushed.failed.map((f) => `${f.agentId ?? "shared"}: ${f.error}`).join("; ")}`;
    }
  } catch (err) {
    console.error("[settings/inference] save failed:", err);
    status = "fail";
    msg = err instanceof Error ? err.message : String(err);
  }
  revalidatePath("/admin/settings");
  const params = new URLSearchParams({ op: "inference", status });
  if (msg) params.set("msg", msg.slice(0, 300));
  redirect(`/admin/settings?${params.toString()}`);
}

/** Forget the saved endpoint; PROD_INFERENCE_URL / PROD_MODEL_ID apply again. */
async function resetInference() {
  "use server";
  await requireAdmin();
  let status: "ok" | "fail" = "ok";
  let msg = "";
  try {
    clearInferenceSettings();
    const pushed = await pushInferenceSettings();
    msg = `back to the environment values; ${pushed.updated.length} gateway config(s) updated`;
    if (pushed.failed.length) status = "fail";
  } catch (err) {
    status = "fail";
    msg = err instanceof Error ? err.message : String(err);
  }
  revalidatePath("/admin/settings");
  const params = new URLSearchParams({ op: "inference", status });
  if (msg) params.set("msg", msg.slice(0, 300));
  redirect(`/admin/settings?${params.toString()}`);
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = (await searchParams) ?? {};
  const op = typeof sp.op === "string" ? sp.op : undefined;
  const status = typeof sp.status === "string" ? sp.status : undefined;
  const msg = typeof sp.msg === "string" ? sp.msg : undefined;

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
  const inference = readInferenceSettings();
  const perUser = gatewayMode() === "per-user";
  const gatewayCount = perUser ? (await listGatewayRecords()).length : 1;
  const inputClass =
    "fc-input w-full";

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Where the model lives and which service connections this tenant shows."
      />
      <div className="mx-auto max-w-4xl p-6 space-y-6">

      {op && status && (
        <div
          className={
            "rounded text-xs px-3 py-2 " +
            (status === "ok"
              ? "bg-[hsl(var(--brand-accent))/0.18] text-[hsl(var(--brand-accent))]"
              : "bg-red-50 text-red-700")
          }
        >
          {status === "ok" ? "✓ " : "⚠ "}
          {op === "inference" ? "Inference settings" : op}
          {status === "ok" ? " saved." : " failed."}
          {msg && <div className="mt-0.5 font-mono break-words">{msg}</div>}
        </div>
      )}

      <section className="space-y-3 fc-card p-4">
        <div>
          <h2 className="fc-card-title">Inference</h2>
          <p className="text-xs text-[hsl(var(--fc-fg-muted))] mt-1">
            Where {gatewayCount === 1 ? "the gateway sends" : "the gateways send"} model requests: an
            OpenAI-compatible server (the tenant&apos;s own SGLang / H100). Saving
            writes the provider into{" "}
            {perUser ? `all ${gatewayCount} per-user gateway configs` : "the gateway config"} at once,
            no redeploy. Leave the URL empty while the model server is down: turns
            then fail with a clear &quot;no model&quot; error instead of timing out.
          </p>
          <p className="text-[11px] text-[hsl(var(--fc-fg-muted))] mt-1">
            Current source:{" "}
            <span className="font-medium text-[hsl(var(--fc-fg-secondary))]">
              {inference.source === "portal"
                ? "saved here"
                : inference.source === "env"
                  ? "the PROD_INFERENCE_URL environment variable"
                  : "none (no endpoint set anywhere)"}
            </span>
          </p>
        </div>
        <form action={saveInference} className="grid grid-cols-[1fr_auto] gap-3 text-sm items-end">
          <label className="col-span-2 block">
            <span className="text-xs text-[hsl(var(--fc-fg-muted))]">Endpoint URL</span>
            <input name="url" type="url" defaultValue={inference.url ?? ""} placeholder="http://inference:8000/v1" className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs text-[hsl(var(--fc-fg-muted))]">Model id (as the server names it)</span>
            <input name="modelId" type="text" defaultValue={inference.modelId} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs text-[hsl(var(--fc-fg-muted))]">Context window (tokens)</span>
            <input name="contextWindow" type="number" min={1024} step={1024} defaultValue={inference.contextWindow} className={inputClass} />
          </label>
          <div className="col-span-2 flex items-center justify-end gap-3">
            <PendingButton
              pendingLabel="Saving…"
              className="fc-btn fc-btn-primary disabled:opacity-70"
            >
              Save and apply
            </PendingButton>
          </div>
        </form>
        {inference.source === "portal" && (
          <form action={resetInference} className="flex justify-end">
            <PendingButton pendingLabel="Resetting…" className="text-xs text-[hsl(var(--fc-fg-muted))] hover:underline">
              Forget the saved values and use the environment again
            </PendingButton>
          </form>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="fc-card-title">
            Service connection visibility
          </h2>
          <p className="text-xs text-[hsl(var(--fc-fg-muted))] mt-1">
            Show or hide service connections to simplify demos. Hiding a service
            only removes its card from the per-user connections panel — it does
            not disable or deprovision anything. The per-tenant enable/disable
            stays on each user&apos;s page.
          </p>
        </div>
        <ServiceVisibilityPanel initial={initial} />
      </section>
      </div>
    </>
  );
}
