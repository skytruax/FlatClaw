"use client";

import { useState } from "react";
import {
  Check,
  X,
  ShieldCheck,
  ChevronRight,
  BadgeCheck,
  ArrowLeftRight,
  Landmark,
  UserCheck,
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

function KindIcon({ kind }: { kind: string }) {
  if (kind === "loan_origination")
    return <Landmark className="w-3.5 h-3.5 text-[hsl(var(--brand-accent))]" />;
  if (kind === "transfer_funds")
    return <ArrowLeftRight className="w-3.5 h-3.5 text-[hsl(var(--brand-accent))]" />;
  return <ShieldCheck className="w-3.5 h-3.5 text-[hsl(var(--brand-accent))]" />;
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

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const resolve = async (toolCallId: string, decision: "approved" | "denied") => {
    setBusy(toolCallId);
    try {
      await fetch("/api/portal/approvals/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolCallId, decision, agent: agentId }),
      });
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
                      EFX request
                    </button>
                  )}
                </div>

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
