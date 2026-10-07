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
      "One-command tenant provisioning — provision-tenant.sh / destroy-tenant.sh: full tenant lifecycle on the target cloud (Northflank lane first; Azure, AWS and Google Cloud lanes follow)",
      "RAGFlow — cited document retrieval behind a stable interface",
      "Semantic memory + embeddings via bge-m3 — on its own GPU card",
      "Scrapling web fetch; additional CRM/ERP connectors as add-on services",
      "Voice — VoxCPM2 open-weight cloning + TTS; Image — ComfyUI + SDXL",
      "Cascade routing + TurboQuant turbo4 — 1M-token context on a single card",
    ],
  },
  {
    version: "v0.6+",
    status: "Future",
    points: [
      "WorkOS SSO for enterprise tenants (Okta / Azure AD / Google Workspace)",
      "Optional shared-GPU multi-tenancy for an entry tier below the dedicated-GPU threshold",
      "Audio/video transcription ingest in RAGFlow",
      'A "studio" for users to author their own skills',
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
