const milestones = [
  {
    version: "v0.4.0",
    status: "This release",
    points: [
      "One gateway per user (opt-in) — each user's agent runs in its own OpenClaw gateway under its own operating-system account, state directory and token, created and supervised by the Portal; the Portal's secrets never reach a gateway",
      "OpenClaw 2026.9.8 on Node 24 — backend-client handshake with a device identity, a pinned tenant baseline (every built-in tool decided by name, allowlisted plugins), and a live gateway contract probe on every pin bump",
      "Approvals that explain themselves — the card shows the request's facts, the tool's reasons for not acting alone, and replay errors in place; the approver's identity reaches the service that executes",
      "Portal — inference endpoint as a setting, sessions named by the model, mid-run messages queued instead of injected, per-user gateway status in Admin",
    ],
  },
  {
    version: "v0.5",
    status: "Next",
    points: [
      "Rule books as files — limits, escalation rules and audit requirements the business writes, applied as code by any connector: inside the limits the agent acts, above them it composes the exact action and waits for a person. Proven on a customer-service agent that refunds inside limits, escalates with the customer's callback details, and writes every conversation back to the CRM",
      "Approvals as the operating console — requests routed by role, each card with the facts, the reasons and how to reach the person affected; decisions written back into the system of record; a weekly view of what the agents handled, resolved alone, or escalated",
      "First-party connectors through the plugin contract — commerce and CRM (Shopify, Dynamics 365), mailbox and calendar, hosting panels, estimating from marked-up drawings, alongside Google and Jira; the contract documented so partners ship their own",
      "Channels — the agent where the customer already is: a chat widget on the storefront running the same rule book, email in and out, Slack or Teams for internal agents; every channel ends in the same case record",
      "Scheduled agents and reports — daily and weekly digests, the report that writes itself across several ERPs, exceptions raised to a person",
      "Model classes per tenant — flagship (one H100-class card), large (two) and frontier (eight, a mixture-of-experts model) on the same platform, chosen per tenant and swappable without touching agents; build sheets for the local and cloud versions on the Builds page",
    ],
  },
  {
    version: "v0.6+",
    status: "Later",
    points: [
      "Voice agents on your own lines — intake, booking, after hours — on the same rule books, approvals and case records",
      "Knowledge search with walls in it — cited answers over your documents, each user seeing only what their role may read",
      "Managed provisioning on the Azure, AWS and Google Cloud lanes with implementation partners; backup and restore of agent state; rehearsed upgrades",
      "Enterprise sign-in (Okta, Entra ID, Google Workspace) when a tenant needs it",
      "A developer agent on the same platform for the teams that build connectors",
    ],
  },
];

export function Roadmap() {
  return (
    <div className="space-y-5">
      {milestones.map((m, i) => (
        <div key={m.version} className="flex gap-5">
          <div className="flex flex-col items-center shrink-0">
            <div
              className={
                "w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold ring-2 " +
                (i === 0
                  ? "bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] ring-[hsl(var(--brand-accent))]"
                  : "bg-[hsl(var(--fc-bg-surface))] text-[hsl(var(--brand-primary))] ring-[hsl(var(--brand-primary))/0.4]")
              }
            >
              {m.version.replace("v", "")}
            </div>
            {i < milestones.length - 1 && (
              <div className="flex-1 w-px bg-[hsl(var(--fc-bg-tertiary))] mt-1 mb-1 min-h-[2rem]" />
            )}
          </div>
          <div className="flex-1 pb-2">
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-lg font-semibold text-[hsl(var(--fc-fg-primary))]">
                {m.version}
              </h3>
              <span
                className={
                  "text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded " +
                  (i === 0
                    ? "bg-[hsl(var(--brand-accent))/0.18] text-[hsl(var(--brand-accent))]"
                    : "bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-secondary))]")
                }
              >
                {m.status}
              </span>
            </div>
            <ul className="text-sm text-[hsl(var(--fc-fg-secondary))] space-y-1.5 mt-2">
              {m.points.map((p) => (
                <li key={p} className="flex gap-2">
                  <span className="text-[hsl(var(--brand-accent))] mt-0.5">▸</span>
                  <span className="leading-relaxed">{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}
