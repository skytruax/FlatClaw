"use client";

import { Fragment, useState } from "react";
import {
  Check,
  X,
  ShieldCheck,
  ChevronRight,
  BadgeCheck,
  ArrowLeftRight,
  Landmark,
  UserCheck,
  AlertTriangle,
  PhoneCall,
} from "lucide-react";

interface ApproverPolicy {
  mode: "self" | "role";
  role?: string;
}
interface PendingApproval {
  toolCallId: string;
  sessionKey: string;
  service: string;
  kind: string;
  title: string;
  requestedByAgentId: string;
  requestedByRole?: string;
  requestedByName?: string;
  approverPolicy: ApproverPolicy;
  amountUsd?: number;
  composedRequest?: unknown;
  /** Why the tool parked this instead of executing it (from the tool's envelope). */
  reasons?: string[];
  composedAt: number;
  routedToYou?: "self" | "role";
}
interface ResolvedApproval extends PendingApproval {
  decision: "approved" | "denied";
  approverName?: string;
  decidedAt: number;
  confirmationRef?: string;
  executionSummary?: string;
}

export interface ApprovalsData {
  pending: PendingApproval[];
  resolved: ResolvedApproval[];
}

function when(ts: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function KindIcon({ kind }: { kind: string }) {
  if (kind === "loan_origination")
    return <Landmark className="w-3.5 h-3.5 text-[hsl(var(--brand-accent))]" />;
  if (kind === "transfer_funds")
    return <ArrowLeftRight className="w-3.5 h-3.5 text-[hsl(var(--brand-accent))]" />;
  if (kind === "escalation_adverse_event")
    return <AlertTriangle className="w-3.5 h-3.5 text-red-600" />;
  if (kind === "escalation_callback")
    return <PhoneCall className="w-3.5 h-3.5 text-[hsl(var(--brand-accent))]" />;
  return <ShieldCheck className="w-3.5 h-3.5 text-[hsl(var(--brand-accent))]" />;
}

interface CustomerContact {
  name?: string;
  phone?: string;
  email?: string;
  bestTime?: string;
}

/**
 * The facts an approver needs, pulled from the composed request: order,
 * amount, items, rule, reason, environment, and how to reach the customer.
 * Generic over services — unknown shapes simply render fewer rows; the raw
 * JSON stays one click away.
 */
function RequestSummary({ composed }: { composed: unknown }) {
  if (!composed || typeof composed !== "object") return null;
  const c = composed as Record<string, unknown>;
  const rows: Array<[string, string]> = [];
  const text = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
  const add = (label: string, v: string | null) => {
    if (v) rows.push([label, v]);
  };
  add("Order", text(c.orderName) ?? text(c.order));
  if (typeof c.amountUsd === "number") add("Amount", usd(c.amountUsd));
  if (typeof c.valueUsd === "number") add("Goods value", usd(c.valueUsd));
  if (Array.isArray(c.items)) {
    const items = (c.items as Array<{ title?: string; quantity?: number }>)
      .map((i) => `${i.quantity ?? 1}× ${i.title ?? "item"}`)
      .join(", ");
    add("Items", items || null);
  }
  add("Rule", text(c.ruleId));
  add("Reason", text(c.reason) ?? text(c.staffNote) ?? text(c.summary));
  const contact = c.customerContact as CustomerContact | undefined;
  if (contact && typeof contact === "object") {
    const bits = [
      text(contact.name),
      text(contact.phone),
      text(contact.email),
      text(contact.bestTime) ? `best time ${contact.bestTime}` : null,
    ].filter((x): x is string => Boolean(x));
    add("Reach the customer", bits.length ? bits.join(" · ") : null);
  }
  add("Environment", text(c.environment));
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 text-[11px] leading-snug">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-[hsl(var(--fc-fg-muted))] whitespace-nowrap">{k}</dt>
          <dd className="text-[hsl(var(--fc-fg-primary))] break-words min-w-0">{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

export default function ApprovalsPanel({
  agentId,
  data,
  loading,
  onChanged,
}: {
  agentId: string;
  data: ApprovalsData | null;
  loading: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const resolve = async (toolCallId: string, decision: "approved" | "denied") => {
    setBusy(toolCallId);
    setErrors((e) => {
      const next = { ...e };
      delete next[toolCallId];
      return next;
    });
    try {
      const r = await fetch("/api/portal/approvals/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolCallId, decision, agent: agentId }),
      });
      if (!r.ok) {
        // Execution failed server-side: the item stays pending; show why so
        // the approver can retry or fix the cause instead of guessing.
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        setErrors((e) => ({ ...e, [toolCallId]: body.error ?? `HTTP ${r.status}` }));
      }
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const pending = data?.pending ?? [];
  const resolved = data?.resolved ?? [];

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4 text-sm">
      <p className="flex items-start gap-1.5 text-xs text-[hsl(var(--fc-fg-muted))]">
        <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[hsl(var(--brand-accent))]" />
        Controlled actions composed by an agent but held for human sign-off. The
        agent can&apos;t execute them on its own.
      </p>

      {loading && !data ? (
        <p className="text-xs text-[hsl(var(--fc-fg-muted))]">Loading…</p>
      ) : pending.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[hsl(var(--fc-bg-tertiary))] px-3 py-6 text-center text-xs text-[hsl(var(--fc-fg-muted))]">
          Nothing awaiting your approval.
        </div>
      ) : (
        <div className="space-y-2.5">
          {pending.map((t) => {
            const isOpen = open.has(t.toolCallId);
            const routedFromOther = t.routedToYou === "role";
            const reasons = (t.reasons ?? []).slice(0, 4);
            return (
              <div
                key={t.toolCallId}
                className="rounded-lg ring-1 ring-[hsl(var(--brand-accent))/0.4] bg-[hsl(var(--fc-bg-soft))] overflow-hidden"
              >
                <div className="px-3 pt-2.5 pb-2 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <KindIcon kind={t.kind} />
                    <span className="font-semibold text-[hsl(var(--fc-fg-primary))] leading-snug">
                      {t.title}
                    </span>
                  </div>
                  {routedFromOther ? (
                    <div className="flex items-center gap-1 text-[11px] text-[hsl(var(--brand-primary))]">
                      <UserCheck className="w-3 h-3" />
                      Needs your sign-off as {t.approverPolicy.role} · requested by{" "}
                      {t.requestedByName ?? t.requestedByAgentId}
                      {t.requestedByRole ? ` (${t.requestedByRole})` : ""}
                    </div>
                  ) : (
                    <div className="text-[11px] text-[hsl(var(--fc-fg-muted))]">
                      Your action · self sign-off
                    </div>
                  )}
                  <RequestSummary composed={t.composedRequest} />
                  {reasons.length > 0 && (
                    <div className="text-[11px] text-[hsl(var(--fc-fg-secondary))]">
                      <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--fc-fg-muted))] font-semibold">
                        Why it needs a person
                      </div>
                      <ul className="list-disc pl-4 space-y-0.5 leading-snug">
                        {reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="text-[10px] text-[hsl(var(--fc-fg-muted))]">
                    composed {when(t.composedAt)}
                  </div>
                </div>

                <div className="flex items-center gap-2 px-3 pb-2.5">
                  <button
                    type="button"
                    disabled={busy === t.toolCallId}
                    onClick={() => resolve(t.toolCallId, "approved")}
                    className="inline-flex items-center gap-1 rounded-md bg-[hsl(var(--brand-accent))] px-2.5 py-1 text-xs font-semibold text-[hsl(var(--brand-accent-fg))] hover:bg-[hsl(var(--brand-primary))] disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy === t.toolCallId}
                    onClick={() => resolve(t.toolCallId, "denied")}
                    className="inline-flex items-center gap-1 rounded-md ring-1 ring-[hsl(var(--fc-bg-tertiary))] px-2.5 py-1 text-xs font-medium text-[hsl(var(--fc-fg-secondary))] hover:bg-[hsl(var(--fc-bg-tertiary))/0.5] disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" />
                    Deny
                  </button>
                  {t.composedRequest != null && (
                    <button
                      type="button"
                      onClick={() => toggle(t.toolCallId)}
                      className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-[hsl(var(--fc-fg-muted))] hover:text-[hsl(var(--fc-fg-secondary))]"
                    >
                      <ChevronRight
                        className={"w-3 h-3 transition-transform " + (isOpen ? "rotate-90" : "")}
                      />
                      Raw request
                    </button>
                  )}
                </div>
                {errors[t.toolCallId] && (
                  <div className="px-3 pb-2 text-[11px] text-red-600 break-words">
                    Could not execute: {errors[t.toolCallId]} — still pending; fix the cause and try again.
                  </div>
                )}

                {isOpen && t.composedRequest != null && (
                  <pre className="border-t border-[hsl(var(--fc-bg-tertiary))] px-3 py-2 text-[10.5px] font-mono whitespace-pre-wrap break-words bg-[hsl(var(--fc-bg-primary))] max-h-72 overflow-auto leading-relaxed">
                    {JSON.stringify(t.composedRequest, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--fc-fg-muted))] font-semibold">
            Recent decisions
          </div>
          {resolved.slice(0, 12).map((t) => (
            <div
              key={t.toolCallId}
              className="rounded-md px-2.5 py-1.5 text-xs ring-1 ring-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-surface))]"
            >
              <div className="flex items-center gap-2">
                {t.decision === "approved" ? (
                  <BadgeCheck className="w-3.5 h-3.5 text-[hsl(var(--brand-accent))] shrink-0" />
                ) : (
                  <X className="w-3.5 h-3.5 text-red-600 shrink-0" />
                )}
                <span className="text-[hsl(var(--fc-fg-primary))] truncate">{t.title}</span>
                <span className="ml-auto text-[10px] text-[hsl(var(--fc-fg-muted))] shrink-0">
                  {t.decision === "approved" && t.confirmationRef
                    ? t.confirmationRef
                    : t.decision}
                  {t.approverName ? ` · ${t.approverName}` : ""}
                  {" · "}
                  {when(t.decidedAt)}
                </span>
              </div>
              {t.decision === "approved" && t.executionSummary && (
                <div className="mt-1 pl-5 text-[10.5px] text-[hsl(var(--brand-primary))]">
                  ✓ {t.executionSummary}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
