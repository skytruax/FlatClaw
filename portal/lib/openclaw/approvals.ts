import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getGatewayClient } from "./adapter";
import { listManagedMcpServices } from "./managed-mcp";
import { db, schema } from "@/lib/db/client";

/**
 * Cross-service human-approval queue.
 *
 * OpenClaw has no primitive to gate an MCP tool call (its exec-approval gate is
 * shell-command shaped), so any controlled MCP action instead returns
 * `status: "PENDING_HUMAN_APPROVAL"` with an `approval` envelope describing who
 * must sign off, and composes — but never executes — the real request. This
 * module derives the queue of those pending actions straight from the session
 * transcripts the portal already reads, routes each to the right approver, and
 * records the decision in the existing `audit_log` table.
 *
 * Routing (`approverPolicy`):
 *   - { mode: "self" }            → the requester signs off on their own action
 *   - { mode: "role", role: "x" } → routed to whoever holds role x (e.g. loan → cfo)
 *
 * "Approve" records the sign-off + a confirmation ref; the pilot wires the real
 * EFX submit behind this same gate.
 */

const PENDING_STATUS = "PENDING_HUMAN_APPROVAL";
const APPROVE_ACTION = "approval.approved";
const DENY_ACTION = "approval.denied";

export type ApproverMode = "self" | "role";
export interface ApproverPolicy {
  mode: ApproverMode;
  role?: string;
}

export interface PendingApproval {
  toolCallId: string;
  sessionKey: string;
  service: string;
  kind: string;
  title: string;
  toolName: string;
  requestedByAgentId: string;
  requestedByRole?: string;
  requestedByName?: string;
  approverPolicy: ApproverPolicy;
  amountUsd?: number;
  composedRequest?: unknown;
  composedAt: number;
  /** Why this is in the viewer's queue: their own action, or routed to their role. */
  routedToYou?: "self" | "role";
}

export type ApprovalDecision = "approved" | "denied";

export interface ResolvedApproval extends PendingApproval {
  decision: ApprovalDecision;
  approverUserId: string;
  approverName?: string;
  decidedAt: number;
  confirmationRef?: string;
  /** Human summary of the real effect applied on approve (e.g. new balances). */
  executionSummary?: string;
}

// ── role resolution (per approval-bearing demo service) ────────────────────

/**
 * Demo services whose MCP tools compose human-approval actions. Personas
 * connect with a role in their service credential; the queue resolves each
 * viewer's role PER SERVICE — a user may hold different roles in each (e.g. a
 * user holding roles on two services at once). Harmless when a service is
 * absent: no credential rows → no agents → that service's queue is empty.
 */
/** Role-bearing services come from the plugin registry — no hardcoded list. */
function approvalServices(): string[] {
  return listManagedMcpServices().map((s) => s.service);
}

interface RoleAgent {
  agentId: string;
  userId: string;
  role: string;
  name: string;
  /** Which service this (agent, role) pairing is for. */
  service: string;
}

/** Every persona connected to an approval-bearing demo service, with role + name. */
async function roleAgents(): Promise<RoleAgent[]> {
  const creds = await db
    .select()
    .from(schema.serviceCredentials)
    .where(inArray(schema.serviceCredentials.service, approvalServices()));
  const out: RoleAgent[] = [];
  for (const c of creds) {
    const u = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, c.userId))
      .limit(1);
    const user = u[0];
    if (!user?.agentId) continue;
    const role = (c.data as { role?: string } | null)?.role ?? "";
    out.push({
      agentId: user.agentId,
      userId: user.id,
      role,
      name: user.identityName ?? user.email ?? user.agentId,
      service: c.service,
    });
  }
  return out;
}

// ── transcript scanning ─────────────────────────────────────────────────────

interface RawMsg {
  role?: string;
  content?: unknown;
  toolCallId?: string;
  toolName?: string;
  timestamp?: number;
}

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === "object" && "text" in b
          ? String((b as { text?: unknown }).text ?? "")
          : "",
      )
      .join("");
  }
  return "";
}

/**
 * Map a flattened MCP tool name (`<prefix><agent>__<tool>`) back to the owning
 * service id via the registry, so the approval queue's executor lookup keys on
 * the authoritative descriptor id regardless of what the envelope claims.
 */
function serviceForToolName(toolName: string): string | undefined {
  for (const s of listManagedMcpServices()) {
    if (s.prefix && toolName.startsWith(s.prefix)) return s.service;
  }
  return undefined;
}

function agentIdFromSessionKey(sessionKey: string): string {
  // agent:<agentId>:<rest>
  const m = /^agent:([^:]+):/.exec(sessionKey);
  return m ? m[1] : "";
}

/** Scan one session's transcript for any action awaiting approval. */
async function scanSession(sessionKey: string): Promise<PendingApproval[]> {
  const client = getGatewayClient();
  let messages: RawMsg[] = [];
  try {
    const r = (await client.call("chat.history", { sessionKey })) as {
      messages?: RawMsg[];
    };
    messages = Array.isArray(r.messages) ? r.messages : [];
  } catch {
    return [];
  }

  const argsById = new Map<string, Record<string, unknown>>();
  for (const m of messages) {
    const blocks = Array.isArray(m.content) ? (m.content as unknown[]) : [];
    for (const raw of blocks) {
      const b = raw as Record<string, unknown>;
      if (b && typeof b === "object" && /tool_?call/i.test(String(b.type)) && typeof b.id === "string") {
        argsById.set(b.id as string, (b.arguments ?? b.input ?? {}) as Record<string, unknown>);
      }
    }
  }

  const out: PendingApproval[] = [];
  for (const m of messages) {
    if (String(m.role ?? "").toLowerCase() !== "toolresult") continue;
    const id = m.toolCallId;
    if (!id) continue;
    let parsed: {
      status?: string;
      action?: string;
      approval?: {
        kind?: string;
        service?: string;
        title?: string;
        requestedByRole?: string;
        requestedByAgentId?: string;
        approverPolicy?: ApproverPolicy;
      };
      composedRequest?: unknown;
      composedTransfer?: unknown;
    };
    try {
      parsed = JSON.parse(blockText(m.content));
    } catch {
      continue;
    }
    if (parsed?.status !== PENDING_STATUS) continue;

    const env = parsed.approval;
    const args = argsById.get(id) ?? {};
    const kind = env?.kind ?? parsed.action ?? "approval";
    const amountUsd = typeof args.amountUsd === "number" ? args.amountUsd : undefined;
    out.push({
      toolCallId: id,
      sessionKey,
      service: serviceForToolName(String(m.toolName ?? "")) ?? env?.service ?? "unknown",
      kind,
      title: env?.title ?? defaultTitle(kind, amountUsd),
      toolName: String(m.toolName ?? ""),
      requestedByAgentId: env?.requestedByAgentId ?? agentIdFromSessionKey(sessionKey),
      requestedByRole: env?.requestedByRole,
      approverPolicy: env?.approverPolicy ?? { mode: "self" },
      amountUsd,
      composedRequest: parsed.composedRequest ?? parsed.composedTransfer,
      composedAt: typeof m.timestamp === "number" ? m.timestamp : Date.now(),
    });
  }
  return out;
}

function defaultTitle(kind: string, amountUsd?: number): string {
  const label = kind.replace(/_/g, " ");
  return amountUsd != null
    ? `${label} — ${amountUsd.toLocaleString("en-US", { style: "currency", currency: "USD" })}`
    : label;
}

interface SessionRow {
  key?: string;
  sessionKey?: string;
}

async function recentSessionKeys(agentId: string, cap = 8): Promise<string[]> {
  const client = getGatewayClient();
  let sessions: SessionRow[] = [];
  try {
    const r = (await client.call("sessions.list", { agentId, limit: 30 })) as {
      sessions?: SessionRow[];
    };
    sessions = Array.isArray(r.sessions) ? r.sessions : [];
  } catch {
    return [];
  }
  return sessions
    .map((s) => s.key ?? s.sessionKey)
    .filter(
      (k): k is string =>
        typeof k === "string" &&
        k.startsWith(`agent:${agentId}:`) &&
        !k.includes(":dashboard:"),
    )
    .slice(0, cap);
}

// ── routing + audit ──────────────────────────────────────────────────────

function decisionRows() {
  return db
    .select()
    .from(schema.auditLog)
    .where(inArray(schema.auditLog.action, [APPROVE_ACTION, DENY_ACTION]));
}

function tsMs(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  return 0;
}

/** Is this approval routed to the given viewer (self as requester, or by role)? */
function routeFor(
  a: PendingApproval,
  viewerAgentId: string,
  viewerRole: string | undefined,
): "self" | "role" | null {
  if (a.approverPolicy.mode === "self") {
    return a.requestedByAgentId === viewerAgentId ? "self" : null;
  }
  if (a.approverPolicy.mode === "role") {
    return viewerRole && a.approverPolicy.role === viewerRole ? "role" : null;
  }
  return null;
}

/**
 * Pending + recently-resolved approvals routed to one viewer. Scans every
 * role-holder's sessions (so an approver sees actions a requester composed),
 * then filters to the ones this viewer is the designated approver for.
 */
export async function listApprovals(
  viewerAgentId: string,
): Promise<{ pending: PendingApproval[]; resolved: ResolvedApproval[] }> {
  const agents = await roleAgents();
  const nameByAgent = new Map(agents.map((a) => [a.agentId, a.name]));
  const nameByUser = new Map(agents.map((a) => [a.userId, a.name]));
  // Viewer's role is resolved PER SERVICE (a user may hold a different role
  // on each connected service) — looked up per-approval in the loop below.
  const roleByAgentService = new Map(
    agents.map((a) => [`${a.service}::${a.agentId}`, a.role]),
  );

  // Scan every persona's sessions (bounded, de-duped — a user may appear under
  // multiple services). A self approval routes back to its requester; a role
  // approval routes to holders of that role IN THAT SERVICE.
  const scanTargets = Array.from(new Set(agents.map((a) => a.agentId)));
  if (!scanTargets.includes(viewerAgentId)) scanTargets.push(viewerAgentId);
  const keyLists = await Promise.all(scanTargets.map((a) => recentSessionKeys(a)));
  const allKeys = keyLists.flat();
  const scanned = (await Promise.all(allKeys.map(scanSession))).flat();

  const rows = await decisionRows();
  const decided = new Map<
    string,
    {
      decision: ApprovalDecision;
      approverUserId: string;
      decidedAt: number;
      confirmationRef?: string;
      executionSummary?: string;
    }
  >();
  for (const row of rows) {
    const md = (row.metadata ?? {}) as {
      toolCallId?: string;
      confirmationRef?: string;
      executionSummary?: string;
    };
    if (typeof md.toolCallId === "string") {
      decided.set(md.toolCallId, {
        decision: row.action === APPROVE_ACTION ? "approved" : "denied",
        approverUserId: row.actorUserId,
        decidedAt: tsMs(row.ts),
        confirmationRef: md.confirmationRef,
        executionSummary: md.executionSummary,
      });
    }
  }

  const pending: PendingApproval[] = [];
  const resolved: ResolvedApproval[] = [];
  for (const a of scanned) {
    const viewerRole = roleByAgentService.get(`${a.service}::${viewerAgentId}`);
    const route = routeFor(a, viewerAgentId, viewerRole);
    if (!route) continue;
    a.requestedByName = nameByAgent.get(a.requestedByAgentId);
    a.routedToYou = route;
    const d = decided.get(a.toolCallId);
    if (d) {
      resolved.push({
        ...a,
        ...d,
        approverName: nameByUser.get(d.approverUserId),
      });
    } else {
      pending.push(a);
    }
  }
  pending.sort((x, y) => y.composedAt - x.composedAt);
  resolved.sort((x, y) => y.decidedAt - x.decidedAt);
  return { pending, resolved };
}

export async function findPending(
  viewerAgentId: string,
  toolCallId: string,
): Promise<PendingApproval | null> {
  const { pending } = await listApprovals(viewerAgentId);
  return pending.find((p) => p.toolCallId === toolCallId) ?? null;
}

function makeConfirmationRef(kind: string): string {
  // Prefix derived from the kind — no per-service hardcoding in shared code.
  const prefix =
    "FC-" + (kind.replace(/[^a-z0-9]+/gi, "").slice(0, 6).toUpperCase() || "ACT");
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

/**
 * Record a sign-off decision in the audit log. Idempotent per tool-call id.
 */
export async function resolveApproval(opts: {
  pending: PendingApproval;
  decision: ApprovalDecision;
  approverUserId: string;
  targetUserId?: string | null;
}): Promise<{ confirmationRef?: string; alreadyResolved: boolean; executionSummary?: string }> {
  const rows = await decisionRows();
  const prior = rows.find(
    (r) => (r.metadata as { toolCallId?: string })?.toolCallId === opts.pending.toolCallId,
  );
  if (prior) {
    const md = prior.metadata as { confirmationRef?: string; executionSummary?: string };
    return {
      confirmationRef: md?.confirmationRef,
      executionSummary: md?.executionSummary,
      alreadyResolved: true,
    };
  }

  // On approve, perform the real effect via the owning service's executor
  // BEFORE recording — if execution throws, nothing is recorded and the item
  // stays pending for a retry. Deny records the rejection without executing.
  let executionSummary: string | undefined;
  if (opts.decision === "approved") {
    const svc = listManagedMcpServices().find((s) => s.service === opts.pending.service);
    if (svc?.executeApproval) {
      const res = await svc.executeApproval({
        kind: opts.pending.kind,
        composedRequest: opts.pending.composedRequest,
        // Session-derived requester — per-user-credential executors act as
        // this user. Falls back to the envelope only if the session key is
        // somehow unparseable.
        requestedByAgentId:
          agentIdFromSessionKey(opts.pending.sessionKey) ||
          opts.pending.requestedByAgentId,
      });
      executionSummary = res?.summary;
    }
  }

  const confirmationRef =
    opts.decision === "approved" ? makeConfirmationRef(opts.pending.kind) : undefined;
  await db.insert(schema.auditLog).values({
    id: randomUUID(),
    actorUserId: opts.approverUserId,
    action: opts.decision === "approved" ? APPROVE_ACTION : DENY_ACTION,
    targetUserId: opts.targetUserId ?? null,
    metadata: {
      toolCallId: opts.pending.toolCallId,
      kind: opts.pending.kind,
      service: opts.pending.service,
      title: opts.pending.title,
      sessionKey: opts.pending.sessionKey,
      requestedByAgentId: opts.pending.requestedByAgentId,
      amountUsd: opts.pending.amountUsd,
      confirmationRef,
      executionSummary,
    },
  });
  return { confirmationRef, alreadyResolved: false, executionSummary };
}
