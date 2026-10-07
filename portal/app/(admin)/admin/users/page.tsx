import { db, schema } from "@/lib/db/client";
import { desc } from "drizzle-orm";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { deleteGatewayAgent } from "@/lib/openclaw/agent-lifecycle";
import { readRegisteredModels } from "@/lib/openclaw/agent-mapper";
import { gatewayMode } from "@/lib/gateways/paths";
import { listGatewayHandles } from "@/lib/gateways/registry";
import { gatewaysOverview } from "@/lib/gateways/admin-status";
import { destroyGateway, restartGateway, startGateway, stopGateway } from "@/lib/gateways/supervisor";
import { GatewayCell, type GatewayRow } from "@/components/admin/GatewayCell";
import { PageHeader } from "@/components/shell/PageHeader";
import { PendingButton } from "@/components/PendingButton";
import { ConfirmDeleteUserForm } from "@/components/ConfirmDeleteUserForm";
import { GatewayStatusPoller } from "@/components/GatewayStatusPoller";

export const dynamic = "force-dynamic";

async function fetchGatewayStatus() {
  try {
    const overview = await gatewaysOverview();
    return {
      ok: true as const,
      // Shared mode: the gateway's config file. Per-user mode: the portal's
      // inference settings, which every gateway gets.
      models: readRegisteredModels(),
      agents: overview.agents,
      defaultAgentId: overview.defaultAgentId,
      gateways: overview.gateways,
      perUser: overview.perUser,
    };
  } catch (err) {
    console.error("[fetchGatewayStatus] failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    // The gateway distinguishes "I'm not reachable" from "I'm reachable but
    // mid-startup" — surface that to the UI so we can show a calmer banner
    // and auto-retry once it's done booting.
    const starting =
      /UNAVAILABLE/i.test(msg) ||
      /gateway startup/i.test(msg) ||
      /still starting/i.test(msg) ||
      /not ready/i.test(msg);
    return {
      ok: false as const,
      starting,
      error: msg,
      perUser: gatewayMode() === "per-user",
    };
  }
}

/** Start / stop / restart one user's gateway (per-user mode). */
async function gatewayAction(formData: FormData) {
  "use server";
  const agentId = String(formData.get("agentId") ?? "");
  const action = String(formData.get("action") ?? "");
  let status: "ok" | "fail" = "ok";
  let msg = "";
  try {
    if (!agentId) throw new Error("no agent id");
    if (action === "start") await startGateway(agentId);
    else if (action === "stop") await stopGateway(agentId);
    else if (action === "restart") await restartGateway(agentId);
    else throw new Error(`unknown gateway action ${JSON.stringify(action)}`);
  } catch (err) {
    console.error(`[gateway-${action}] ${agentId} failed:`, err);
    status = "fail";
    msg = err instanceof Error ? err.message : String(err);
  }
  revalidatePath("/admin/users");
  const params = new URLSearchParams({ op: `gateway ${action}`, status });
  if (msg) params.set("msg", msg.slice(0, 240));
  redirect(`/admin/users?${params.toString()}`);
}

async function createUser(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const identityName = String(formData.get("identityName") ?? "").trim();
  const identityEmoji = String(formData.get("identityEmoji") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return;

  const userId = randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);
  await db.insert(schema.users).values({
    id: userId,
    email,
    passwordHash,
    role: "user",
    identityName: identityName || email.split("@")[0],
    identityEmoji: identityEmoji || null,
    agentId: null,
  });

  // Auto-provision: pick a model. Prefer agents.defaults.model from openclaw.json,
  // else fall back to the first registered model. Surfaces an error to the
  // browser console if the gateway is unreachable; the row stays in the DB so
  // the admin can retry.
  const models = readRegisteredModels();
  const { readDefaultModel } = await import("@/lib/openclaw/agent-mapper");
  const modelRef =
    readDefaultModel() ??
    (models.length > 0 ? `${models[0].providerId}/${models[0].id}` : null);

  if (modelRef) {
    try {
      const { provisionAgentForUser } = await import("@/lib/openclaw/provision");
      await provisionAgentForUser({
        userId,
        email,
        identityName: identityName || email.split("@")[0],
        identityEmoji: identityEmoji || null,
        modelRef,
      });
    } catch (err) {
      console.error("[provisioning] failed:", err);
    }
  } else {
    console.warn(
      "[create-user] no registered models available — skipping auto-provision",
    );
  }

  revalidatePath("/admin/users");
  redirect("/admin/users");
}

async function purgeOrphanAgents() {
  "use server";
  try {
    const portalAgentIds = new Set(
      (await db.select().from(schema.users)).map((r) => r.agentId).filter(
        (x): x is string => !!x,
      ),
    );
    for (const handle of await listGatewayHandles()) {
      const list = (await handle.client.call("agents.list", {})) as {
        agents?: { id: string }[];
        defaultId?: string;
      };
      const defaultId = list.defaultId ?? "main";
      // On a per-user gateway the only agents that belong are the user's own
      // and its service sub-agents (`<agent>-<service>`).
      const belongs = (id: string) =>
        id === defaultId ||
        (handle.record
          ? id === handle.record.agentId || id.startsWith(`${handle.record.agentId}-`)
          : portalAgentIds.has(id));
      const orphans = (list.agents ?? []).map((a) => a.id).filter((id) => !belongs(id));
      for (const id of orphans) {
        try {
          await deleteGatewayAgent(id, handle.client);
        } catch (err) {
          console.error(`[purge-orphans] failed to delete ${id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("[purge-orphans] failed:", err);
  }
  revalidatePath("/admin/users");
}

async function deleteUser(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  const target = rows[0];
  if (!target) {
    redirect("/admin/users?op=delete-user&status=ok");
  }

  let status: "ok" | "fail" = "ok";
  let msg = "";

  // 1. Delete the gateway agent, which moves the workspace + agent dir to
  //    trash. If the agent already doesn't exist (orphan or prior delete) we
  //    proceed — that's the desired end state anyway. A deletion the gateway
  //    reports as incomplete fails here, and the user row stays so the admin
  //    can retry (see lib/openclaw/agent-lifecycle.ts).
  if (target.agentId) {
    try {
      // Per-user mode: the user's whole gateway goes (process, registry row,
      // Unix account); its state directory is kept under gateways/.trash.
      if (gatewayMode() === "per-user") await destroyGateway(target.agentId);
      else await deleteGatewayAgent(target.agentId);
    } catch (err) {
      console.error("[delete-user] gateway agents.delete failed:", err);
      status = "fail";
      msg = err instanceof Error ? err.message : String(err);
    }
  }

  // 2. Yank per-user vault rows + every managed-MCP cap token. The
  //    google plugin owns its own service_oauth_tokens cleanup via
  //    deleteCredential; cpanel/caldav similarly. We sweep all
  //    registered services here so every plugin gets a chance to clean up.
  if (status === "ok") {
    try {
      await import("@/lib/openclaw/services");
      const { listManagedMcpServices, deprovisionManagedMcpForUser } =
        await import("@/lib/openclaw/managed-mcp");
      const { revokeCapabilityToken } = await import(
        "@/lib/oauth/capability-tokens"
      );
      for (const svc of listManagedMcpServices()) {
        await deprovisionManagedMcpForUser(svc.service, id).catch((err) =>
          console.warn(
            `[delete-user] deprovision ${svc.service} non-fatal:`,
            err,
          ),
        );
        await svc.deleteCredential(id).catch((err) =>
          console.warn(
            `[delete-user] deleteCredential ${svc.service} non-fatal:`,
            err,
          ),
        );
        await revokeCapabilityToken(id, `${svc.service}.token`).catch(
          () => undefined,
        );
      }
    } catch (err) {
      console.warn("[delete-user] managed-mcp cleanup non-fatal:", err);
    }

    // 3. DB row last — only after the agent + workspace are gone (or were
    //    never there).
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }

  revalidatePath("/admin/users");
  const params = new URLSearchParams({ op: "delete-user", status });
  if (msg) params.set("msg", msg.slice(0, 240));
  redirect(`/admin/users?${params.toString()}`);
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const op = typeof sp.op === "string" ? sp.op : undefined;
  const status = typeof sp.status === "string" ? sp.status : undefined;
  const msg = typeof sp.msg === "string" ? sp.msg : undefined;

  const [rows, gatewayStatus] = await Promise.all([
    db.select().from(schema.users).orderBy(desc(schema.users.createdAt)),
    fetchGatewayStatus(),
  ]);

  const portalAgentIds = new Set(
    rows.map((r) => r.agentId).filter((x): x is string => !!x),
  );
  const gatewayAgentIds = new Set(
    gatewayStatus.ok ? gatewayStatus.agents.map((a) => a.id) : [],
  );
  // 'main' is the gateway's built-in default; it can't be deleted and isn't
  // really orphaned. Hide it from the orphan list.
  const orphanGatewayAgents = gatewayStatus.ok
    ? gatewayStatus.agents.filter(
        (a) => a.id !== "main" && !portalAgentIds.has(a.id),
      )
    : [];
  const perUser = gatewayStatus.perUser;
  const gatewayByAgent = new Map<string, GatewayRow>(
    (gatewayStatus.ok ? gatewayStatus.gateways : []).map((g) => [g.agentId, g]),
  );
  const runningGateways = gatewayStatus.ok
    ? gatewayStatus.gateways.filter((g) => g.state === "running" && g.reachable).length
    : 0;

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Users"
        description={
          perUser
            ? "Each user has an agent of their own, running on a gateway of their own under its own account."
            : "Each user has an agent of their own on this tenant's gateway."
        }
        actions={
          <span className="text-sm text-[hsl(var(--brand-accent-fg))/0.75]">
            {rows.length} {rows.length === 1 ? "user" : "users"}
          </span>
        }
      />
      <div className="mx-auto max-w-6xl p-6">
      {op && status && (
        <div
          className={
            "mb-4 rounded text-xs px-3 py-2 " +
            (status === "ok"
              ? "bg-[hsl(var(--brand-accent))/0.18] text-[hsl(var(--brand-accent))]"
              : "bg-red-50 text-red-700")
          }
        >
          {status === "ok"
            ? `✓ ${op === "delete-user" ? "User deleted" : op} successfully.`
            : (
              <>
                <div className="font-semibold">⚠ {op} failed</div>
                {msg && <div className="mt-0.5 font-mono break-words">{msg}</div>}
                <div className="mt-1 text-[10px] text-red-700/80">
                  The gateway may be reloading. Try again in a moment.
                </div>
              </>
            )}
        </div>
      )}
      <section
        className={
          "mb-6 rounded-lg p-4 ring-1 " +
          (gatewayStatus.ok
            ? "bg-[hsl(var(--fc-bg-surface))] ring-[hsl(var(--fc-bg-tertiary))]"
            : !gatewayStatus.ok && gatewayStatus.starting
              ? "bg-amber-50 ring-amber-200"
              : "bg-red-50 ring-red-200")
        }
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium">
              {perUser ? "FlatClaw gateways (one per user)" : "FlatClaw Gateway"}
            </h2>
            <p className="text-xs text-[hsl(var(--fc-fg-muted))]">
              {gatewayStatus.ok ? (
                perUser
                  ? `${runningGateways} of ${gatewayStatus.gateways.length} gateway${gatewayStatus.gateways.length === 1 ? "" : "s"} running — ${gatewayStatus.models.length} model${gatewayStatus.models.length === 1 ? "" : "s"} (from Settings), ${gatewayStatus.agents.length} agent${gatewayStatus.agents.length === 1 ? "" : "s"}`
                  : `Connected — ${gatewayStatus.models.length} model${gatewayStatus.models.length === 1 ? "" : "s"}, ${gatewayStatus.agents.length} agent${gatewayStatus.agents.length === 1 ? "" : "s"}`
              ) : gatewayStatus.starting ? (
                <>
                  Gateway is starting up after a config change…
                  <GatewayStatusPoller enabled />
                </>
              ) : (
                `Unreachable — ${gatewayStatus.error}`
              )}
            </p>
          </div>
          <span
            className={
              "text-xs font-medium px-2 py-0.5 rounded " +
              (gatewayStatus.ok
                ? "bg-[hsl(var(--brand-accent))/0.18] text-[hsl(var(--brand-accent))]"
                : !gatewayStatus.ok && gatewayStatus.starting
                  ? "bg-amber-100 text-amber-700"
                  : "bg-red-100 text-red-700")
            }
          >
            {gatewayStatus.ok
              ? perUser && runningGateways < gatewayStatus.gateways.length
                ? "degraded"
                : "online"
              : gatewayStatus.starting
                ? "starting"
                : "offline"}
          </span>
        </div>
        {gatewayStatus.ok && gatewayStatus.models.length > 0 && (
          <ul className="mt-2 text-xs text-[hsl(var(--fc-fg-secondary))] list-disc pl-5">
            {gatewayStatus.models.map((m) => (
              <li key={`${m.providerId}/${m.id}`}>
                <span className="font-medium">{m.name}</span>
                <code className="font-mono text-[hsl(var(--fc-fg-muted))] ml-1.5">
                  ({m.id})
                </code>
              </li>
            ))}
          </ul>
        )}
        {gatewayStatus.ok && orphanGatewayAgents.length > 0 && (
          <div className="mt-3 text-xs text-[hsl(var(--fc-fg-secondary))]">
            <div className="flex items-center justify-between mb-1">
              <p className="font-medium">
                {orphanGatewayAgents.length} gateway agent
                {orphanGatewayAgents.length === 1 ? "" : "s"} not linked to a portal user:
              </p>
              <form action={purgeOrphanAgents}>
                <PendingButton
                  pendingLabel="Purging…"
                  className="text-xs text-red-600 hover:underline disabled:opacity-60"
                >
                  Purge orphans
                </PendingButton>
              </form>
            </div>
            <ul className="list-disc pl-5">
              {orphanGatewayAgents.map((a) => (
                <li key={a.id}>
                  <code className="font-mono">{a.id}</code>
                  {a.name && a.name !== a.id ? (
                    <span className="text-[hsl(var(--fc-fg-muted))] ml-1.5">
                      — {a.name}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="mb-6 fc-card p-4">
        <h2 className="fc-card-title mb-3">Add user</h2>
        <form action={createUser} className="grid grid-cols-2 gap-3 text-sm">
          <input
            name="email"
            type="email"
            required
            placeholder="email"
            className="fc-input"
          />
          <input
            name="identityName"
            type="text"
            placeholder="display name (optional)"
            className="fc-input"
          />
          <input
            name="password"
            type="password"
            required
            placeholder="initial password"
            className="fc-input"
          />
          <input
            name="identityEmoji"
            type="text"
            maxLength={4}
            placeholder="emoji (optional)"
            className="fc-input"
          />
          <div className="col-span-2 flex items-center justify-between">
            <p className="text-xs text-[hsl(var(--fc-fg-muted))]">
              {gatewayStatus.ok && gatewayStatus.models.length > 0 ? (
                <>
                  Will auto-provision a FlatClaw agent on the default model:{" "}
                  <span className="font-medium text-[hsl(var(--fc-fg-secondary))]">
                    {gatewayStatus.models[0].name}
                  </span>
                </>
              ) : (
                <span className="text-amber-600">
                  {perUser
                    ? "No inference endpoint is set (Settings → Inference) — agent provisioning will be skipped until it is."
                    : "Gateway has no registered models — agent provisioning will be skipped."}
                </span>
              )}
            </p>
            <PendingButton
              pendingLabel="Provisioning…"
              className="fc-btn fc-btn-primary disabled:opacity-70"
            >
              Add user
            </PendingButton>
          </div>
        </form>
      </section>

      <div className="fc-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[hsl(var(--fc-bg-soft))]">
          <tr>
            <th className="fc-th">User</th>
            <th className="fc-th">Role</th>
            <th className="fc-th">Agent</th>
            {perUser && <th className="fc-th">Gateway</th>}
            <th className="fc-th">Created</th>
            <th className="fc-th"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr
              key={u.id}
              className="border-t border-[hsl(var(--fc-bg-tertiary))] transition hover:bg-[hsl(var(--fc-bg-soft))]"
            >
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  {u.identityEmoji && <span>{u.identityEmoji}</span>}
                  <div>
                    <div className="font-medium">
                      {u.identityName ?? u.email}
                    </div>
                    <div className="text-xs text-[hsl(var(--fc-fg-muted))]">
                      {u.email}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5">
                <span
                  className={
                    u.role === "admin"
                      ? "fc-chip fc-chip-navy"
                      : "fc-chip fc-chip-muted"
                  }
                >
                  {u.role}
                </span>
              </td>
              <td className="px-3 py-2.5 text-[hsl(var(--fc-fg-secondary))]">
                {u.agentId ? (
                  <div className="flex flex-col">
                    <code className="font-mono text-xs">{u.agentId}</code>
                    {gatewayStatus.ok && (
                      <span className="text-[10px] mt-0.5">
                        {gatewayAgentIds.has(u.agentId) ? (
                          <span className="text-[hsl(var(--brand-accent))]">
                            ● live on gateway
                          </span>
                        ) : (
                          <span className="text-amber-600">
                            ⚠ missing on gateway
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="opacity-60">— not provisioned</span>
                )}
              </td>
              {perUser && (
                <td className="px-3 py-2.5">
                  <GatewayCell
                    gateway={u.agentId ? (gatewayByAgent.get(u.agentId) ?? null) : null}
                    action={gatewayAction}
                  />
                </td>
              )}
              <td className="px-3 py-2.5 text-[hsl(var(--fc-fg-muted))]">
                {u.createdAt
                  ? new Date(u.createdAt).toLocaleDateString()
                  : "—"}
              </td>
              <td className="px-3 py-2.5 text-right">
                <Link
                  href={`/admin/users/${u.id}`}
                  className="fc-btn fc-btn-sm fc-btn-secondary mr-2"
                >
                  Open
                </Link>
                {u.role !== "admin" && (
                  <ConfirmDeleteUserForm
                    userId={u.id}
                    email={u.email}
                    identityName={u.identityName}
                    action={deleteUser}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      </div>
    </>
  );
}
