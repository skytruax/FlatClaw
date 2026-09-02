const milestones = [
  {
    version: "v0.3.0",
    status: "This release",
    points: [
      "Human approval engine — consequential MCP actions (outbound mail, destructive/exposing calls) are composed, pause for human sign-off in the Portal, and replay with the user's own credentials on approve",
      "Public/private MCP split — the repo ships mcp/public (Google, Jira); private add-on connectors self-register through the same plugin registry",
      "Harness runtime pin bumped and re-verified against the RBAC contract (tool-name flattening, deny-glob pipeline)",
      "Portal approvals queue + per-service admin visibility controls",
    ],
  },
  {
    version: "v0.4",
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
    version: "v0.5+",
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
