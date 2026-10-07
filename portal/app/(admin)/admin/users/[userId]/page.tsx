import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ChatPanel from "@/components/chat/ChatPanel";
import { SidebarTabs } from "@/components/sidebar/SidebarTabs";
import { PendingButton } from "@/components/PendingButton";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { gatewayMode } from "@/lib/gateways/paths";
import { gatewayClientFor, gatewayRecord } from "@/lib/gateways/registry";
import { gatewayProcessStatus, restartGateway, startGateway, stopGateway } from "@/lib/gateways/supervisor";
import { GatewayCell, type GatewayRow } from "@/components/admin/GatewayCell";
import { PageHeader } from "@/components/shell/PageHeader";
import Link from "next/link";
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
 *   1. rewrite SOUL.md / AGENTS.md from current state (tenant
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

    // 1. SOUL/AGENTS markdown — tenant skill allowlist comes from
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
    const client = await gatewayClientFor(agentId);
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
  "gateway-start": "Start gateway",
  "gateway-stop": "Stop gateway",
  "gateway-restart": "Restart gateway",
};

/** Start / stop / restart this user's gateway (per-user mode). */
async function gatewayAction(formData: FormData) {
  "use server";
  const agentId = String(formData.get("agentId") ?? "");
  const action = String(formData.get("action") ?? "");
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.agentId, agentId))
    .limit(1);
  const userId = rows[0]?.id;
  if (!userId) notFound();
  await withActionResult(userId, `gateway-${action}`, async () => {
    if (action === "start") await startGateway(agentId);
    else if (action === "stop") await stopGateway(agentId);
    else if (action === "restart") await restartGateway(agentId);
    else throw new Error(`unknown gateway action ${JSON.stringify(action)}`);
  });
}

/** The last ~16 KB of a gateway's log, for the card below. */
function tailFile(path: string, maxBytes = 16 * 1024, maxLines = 25): string {
  if (!existsSync(path)) return "";
  const size = statSync(path).size;
  const start = Math.max(0, size - maxBytes);
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8").split("\n").slice(-maxLines).join("\n").trim();
  } finally {
    closeSync(fd);
  }
}

async function loadGatewayCard(
  agentId: string,
): Promise<{ row: GatewayRow; stateDir: string; logTail: string } | null> {
  if (gatewayMode() !== "per-user") return null;
  const record = await gatewayRecord(agentId);
  if (!record) return null;
  const proc = gatewayProcessStatus(agentId);
  let reachable = false;
  let error: string | null = null;
  if (proc.state === "running") {
    try {
      await (await gatewayClientFor(agentId)).call("models.list", {}, 4_000);
      reachable = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    row: { agentId, port: record.port, unixUser: record.unixUser, ...proc, reachable, error },
    stateDir: record.stateDir,
    logTail: tailFile(join(record.stateDir, "gateway.log")),
  };
}

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
  const gatewayCard = user.agentId ? await loadGatewayCard(user.agentId) : null;

  return (
    <>
      <PageHeader
        back={
          <Link href="/admin/users" className="transition hover:text-[hsl(var(--brand-accent))]">
            ← All users
          </Link>
        }
        eyebrow={user.role === "admin" ? "Administrator" : "User"}
        title={
          <>
            {user.identityEmoji && <span className="mr-1.5">{user.identityEmoji}</span>}
            {user.identityName ?? user.email}
          </>
        }
        description={user.email}
      />
      <div className="mx-auto max-w-6xl p-6 space-y-4">
      <ActionBanner op={op} status={status} msg={msg} />

      <div className="fc-card p-4">
        <h2 className="fc-card-title mb-2">Profile</h2>
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
              <code className="font-mono">SOUL.md</code> +{" "}
              <code className="font-mono">AGENTS.md</code>, refreshes skill
              config, and re-registers the user&apos;s managed MCPs from their
              stored credentials.
            </span>
            <form action={syncAgent}>
              <input type="hidden" name="userId" value={user.id} />
              <PendingButton
                pendingLabel="Syncing…"
                className="fc-btn fc-btn-sm fc-btn-primary shrink-0 ml-3 disabled:opacity-70"
              >
                Sync
              </PendingButton>
            </form>
          </div>
        )}
      </div>

      {gatewayCard && (
        <div className="fc-card p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="fc-card-title">Gateway</h2>
            <span className="text-[10px] text-[hsl(var(--fc-fg-muted))]">
              this user&apos;s own OpenClaw process
            </span>
          </div>
          <GatewayCell gateway={gatewayCard.row} action={gatewayAction} compact={false} />
          <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mt-3">
            <dt className="text-[hsl(var(--fc-fg-muted))]">State directory</dt>
            <dd><code className="font-mono break-all">{gatewayCard.stateDir}</code></dd>
            <dt className="text-[hsl(var(--fc-fg-muted))]">Runs as</dt>
            <dd>
              {gatewayCard.row.unixUser ? (
                <code className="font-mono">{gatewayCard.row.unixUser}</code>
              ) : (
                <span className="text-amber-600">the portal&apos;s own user (no OS isolation)</span>
              )}
            </dd>
            {gatewayCard.row.pid !== null && (
              <>
                <dt className="text-[hsl(var(--fc-fg-muted))]">PID</dt>
                <dd><code className="font-mono">{gatewayCard.row.pid}</code></dd>
              </>
            )}
          </dl>
          {gatewayCard.logTail && (
            <details className="mt-3">
              <summary className="text-xs cursor-pointer text-[hsl(var(--fc-fg-secondary))]">Last log lines</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-[hsl(var(--fc-bg-primary))] p-2 text-[10px] leading-snug font-mono whitespace-pre-wrap break-all">
                {gatewayCard.logTail}
              </pre>
            </details>
          )}
        </div>
      )}

      <div className="fc-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="fc-card-title">Service connections</h2>
          <span className="text-[10px] text-[hsl(var(--fc-fg-muted))]">
            per-user vault + capability bridge
          </span>
        </div>
        <ConnectionsTabs userId={user.id} />
      </div>

      {user.agentId && agentLive && <ToolAccessPanel userId={user.id} />}

      {user.agentId && agentLive && (
        <div className="fc-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="fc-card-title">
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
        <h2 className="fc-card-title mb-2">Chat as {user.identityName ?? user.email}</h2>
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
          <div className="fc-card p-4 text-sm text-[hsl(var(--fc-fg-secondary))] flex items-center justify-between">
            <span>
              {user.agentId
                ? "Agent record exists on portal but is missing on the gateway. Repair will re-create it."
                : "This user has not been provisioned as an OpenClaw agent yet."}
            </span>
            <form action={repairAgent}>
              <input type="hidden" name="userId" value={user.id} />
              <button
                type="submit"
                className="fc-btn fc-btn-primary"
              >
                {user.agentId ? "Repair agent" : "Provision agent"}
              </button>
            </form>
          </div>
        )}
      </div>
      </div>
    </>
  );
}
