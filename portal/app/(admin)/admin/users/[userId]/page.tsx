import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ChatPanel from "@/components/chat/ChatPanel";
import { SidebarTabs } from "@/components/sidebar/SidebarTabs";
import { PendingButton } from "@/components/PendingButton";
import { getGatewayClient } from "@/lib/openclaw/adapter";
import { syncSkillsForUser } from "@/lib/openclaw/sync-skills";
import ConnectionsTabs from "@/components/services/ConnectionsTabs";
import ScheduledTasksPanel from "@/components/scheduler/ScheduledTasksPanel";
import ToolAccessPanel from "@/components/users/ToolAccessPanel";

export const dynamic = "force-dynamic";

/**
 * Server-action helper: runs `op`, catches anything that bubbles, then
 * redirects back to the user page with a `?op=...&status=ok|fail&msg=...`
 * query so the page can render a banner instead of crashing into Next.js'
 * red error overlay.
 *
 * Note: `redirect()` itself throws an internal NEXT_REDIRECT error that the
 * router consumes — we have to re-throw it so it isn't trapped as a "real"
 * failure.
 */
async function withActionResult(
  userId: string,
  op: string,
  fn: () => Promise<void>,
): Promise<never> {
  let status: "ok" | "fail" = "ok";
  let msg = "";
  try {
    await fn();
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      typeof (err as { digest?: unknown }).digest === "string" &&
      (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
    ) {
      throw err;
    }
    console.error(`[${op}] failed:`, err);
    status = "fail";
    msg = err instanceof Error ? err.message : String(err);
  }
  revalidatePath(`/admin/users/${userId}`);
  const params = new URLSearchParams({ op, status });
  if (msg) params.set("msg", msg.slice(0, 240));
  redirect(`/admin/users/${userId}?${params.toString()}`);
}

// Skill management is handled by the unified ConnectionsTabs panel below
// (Service connections → Skills tab). Tenant policy lives in
// `tenant_skill_settings` + materialization to `agents.defaults.skills`,
// driven by /api/portal/users/<id>/skills/<name>. No per-skill server
// actions in this file anymore.
//
// cPanel + CalDav credential management likewise goes through the plugin
// layer (`lib/openclaw/services/<svc>.plugin.ts` + ServicesPanel client
// component) — no per-service server actions either.

async function repairAgent(formData: FormData) {
  "use server";
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return;
  await withActionResult(userId, "repair", async () => {
    const { reprovisionUser } = await import("@/lib/openclaw/provision");
    await reprovisionUser(userId);
    revalidatePath("/admin/users");
  });
}

/**
 * One-click sync: re-runs the parts of provisioning that matter for an
 * already-created agent —
 *
 *   1. rewrite SOUL.md / AGENTS.md / TOOLS.md from current state (tenant
 *      skill allowlist, which managed services the user has creds for), and
 *   2. re-register the user's managed MCPs (cpanel, caldav, google, jira)
 *      from their stored credentials against the live `mcp.servers` config —
 *      catches agents whose MCP entry drifted or was dropped.
 *
 * Reads the agent's current skill set so it doesn't clobber operator toggles.
 * Does NOT re-`agents.create` (that's the "Repair agent" path).
 */
async function syncAgent(formData: FormData) {
  "use server";
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return;
  await withActionResult(userId, "sync", async () => {
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    const u = rows[0];
    if (!u?.agentId) throw new Error("user has no agent yet");

    // 1. SOUL/AGENTS/TOOLS markdown — tenant skill allowlist comes from
    //    tenant_skill_settings (materialized into agents.defaults.skills by
    //    tenant-skills.ts); this just rewrites the workspace files.
    await syncSkillsForUser(userId);

    // 2. Managed MCPs — register/refresh each service the user has creds
    //    for (and deprovision the ones they don't). Mirrors what
    //    provisionAgentForUser does after creating the agent. The capability
    //    token rides into the MCP via its env; no key-manipulation here.
    const { syncAllManagedMcpsForUser } = await import("@/lib/openclaw/managed-mcp");
    await import("@/lib/openclaw/services"); // register service plugins first
    await syncAllManagedMcpsForUser(userId);
  });
}

interface GatewayAgent {
  id: string;
}

async function checkAgentExists(agentId: string): Promise<boolean> {
  try {
    const client = getGatewayClient();
    const result = (await client.call("agents.list", {})) as {
      agents?: GatewayAgent[];
    };
    return (result.agents ?? []).some((a) => a.id === agentId);
  } catch {
    return false;
  }
}

const OP_LABELS: Record<string, string> = {
  "save-skills": "Save skills",
  sync: "Sync",
  repair: "Repair agent",
};

function ActionBanner({
  op,
  status,
  msg,
}: {
  op?: string;
  status?: string;
  msg?: string;
}) {
  if (!op || !status) return null;
  const label = OP_LABELS[op] ?? op;
  if (status === "ok") {
    return (
      <div className="rounded bg-[hsl(var(--brand-accent))/0.18] text-[hsl(var(--brand-accent))] text-xs px-3 py-2">
        ✓ {label} completed.
      </div>
    );
  }
  return (
    <div className="rounded bg-red-50 text-red-700 text-xs px-3 py-2">
      <div className="font-semibold">⚠ {label} failed</div>
      {msg && <div className="mt-0.5 font-mono break-words">{msg}</div>}
      <div className="mt-1 text-[10px] text-red-700/80">
        The gateway often takes 3–5s to come back after a config change. Try
        again in a moment.
      </div>
    </div>
  );
}

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await params;
  const sp = await searchParams;
  const op = typeof sp.op === "string" ? sp.op : undefined;
  const status = typeof sp.status === "string" ? sp.status : undefined;
  const msg = typeof sp.msg === "string" ? sp.msg : undefined;
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (rows.length === 0) notFound();
  const user = rows[0];
  const agentLive = user.agentId
    ? await checkAgentExists(user.agentId)
    : false;

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-4">
      <ActionBanner op={op} status={status} msg={msg} />
      <div>
        <h1 className="text-xl font-semibold">
          {user.identityEmoji && <span className="mr-1.5">{user.identityEmoji}</span>}
          {user.identityName ?? user.email}
        </h1>
        <p className="text-sm text-[hsl(var(--fc-fg-muted))]">{user.email}</p>
      </div>

      <div className="rounded-lg bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-4">
        <h2 className="text-sm font-medium mb-2">Profile</h2>
        <dl className="text-sm grid grid-cols-2 gap-y-1.5">
          <dt className="text-[hsl(var(--fc-fg-muted))]">Role</dt>
          <dd>{user.role}</dd>
          <dt className="text-[hsl(var(--fc-fg-muted))]">Agent</dt>
          <dd className="flex items-center gap-2">
            {user.agentId ? (
              <>
                <code className="font-mono">{user.agentId}</code>
                {agentLive ? (
                  <span className="text-xs text-[hsl(var(--brand-accent))]">● live</span>
                ) : (
                  <span className="text-xs text-amber-600">⚠ missing on gateway</span>
                )}
              </>
            ) : (
              <span className="opacity-60">— not yet provisioned</span>
            )}
          </dd>
          <dt className="text-[hsl(var(--fc-fg-muted))]">Created</dt>
          <dd>
            {user.createdAt ? new Date(user.createdAt).toLocaleString() : "—"}
          </dd>
        </dl>
        {user.agentId && (
          <div className="mt-3 pt-3 border-t border-[hsl(var(--fc-bg-tertiary))] flex items-center justify-between">
            <span className="text-[11px] text-[hsl(var(--fc-fg-muted))]">
              Re-runs everything provisioning does: rewrites{" "}
              <code className="font-mono">AGENTS.md</code> +{" "}
              <code className="font-mono">TOOLS.md</code>, refreshes skill
              config, and re-registers the user&apos;s managed MCPs from their
              stored credentials.
            </span>
            <form action={syncAgent}>
              <input type="hidden" name="userId" value={user.id} />
              <PendingButton
                pendingLabel="Syncing…"
                className="rounded bg-[hsl(var(--brand-accent))] px-3 py-1 text-xs font-semibold text-[hsl(var(--brand-accent-fg))] hover:bg-[hsl(var(--brand-primary))] shrink-0 ml-3 disabled:opacity-70"
              >
                Sync
              </PendingButton>
            </form>
          </div>
        )}
      </div>

      <div className="rounded-lg bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium">Service connections</h2>
          <span className="text-[10px] text-[hsl(var(--fc-fg-muted))]">
            per-user vault + capability bridge
          </span>
        </div>
        <ConnectionsTabs userId={user.id} />
      </div>

      {user.agentId && agentLive && <ToolAccessPanel userId={user.id} />}

      {user.agentId && agentLive && (
        <div className="rounded-lg bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium">
              Scheduled tasks{" "}
              <span className="text-[hsl(var(--fc-fg-muted))] font-normal">
                (acting as {user.identityName ?? user.email})
              </span>
            </h2>
          </div>
          <ScheduledTasksPanel
            targetUserId={user.id}
            chatLinkBase={`/admin/users/${user.id}`}
          />
        </div>
      )}

      <div>
        <h2 className="text-sm font-medium mb-2">Chat as {user.identityName ?? user.email}</h2>
        {user.agentId && agentLive ? (
          (() => {
            const requestedSession = typeof sp.session === "string" ? sp.session : undefined;
            const activeSessionKey = requestedSession ?? `agent:${user.agentId}:main`;
            return (
              <div className="grid grid-cols-[360px_1fr] gap-4">
                <SidebarTabs
                  agentId={user.agentId}
                  targetUserId={user.id}
                  activeSessionKey={activeSessionKey}
                  className="h-[75vh]"
                />
                <ChatPanel
                  targetUserId={user.id}
                  agentId={user.agentId}
                  identityName={user.identityName ?? user.email}
                  sessionKey={activeSessionKey}
                />
              </div>
            );
          })()
        ) : (
          <div className="rounded-lg bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-4 text-sm text-[hsl(var(--fc-fg-secondary))] flex items-center justify-between">
            <span>
              {user.agentId
                ? "Agent record exists on portal but is missing on the gateway. Repair will re-create it."
                : "This user has not been provisioned as an OpenClaw agent yet."}
            </span>
            <form action={repairAgent}>
              <input type="hidden" name="userId" value={user.id} />
              <button
                type="submit"
                className="rounded bg-[hsl(var(--brand-accent))] px-4 py-1.5 text-sm font-semibold text-[hsl(var(--brand-accent-fg))]"
              >
                {user.agentId ? "Repair agent" : "Provision agent"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
