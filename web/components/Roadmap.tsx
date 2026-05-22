const milestones = [
  {
    version: "v0.2.0",
    status: "This release",
    points: [
      "Live inference — Gemma 4 31B-IT FP8 on a dedicated H100 at the native 256K context",
      "MCP service integrations — Google, CalDAV/IMAP, Jira, per-user credentials",
      "Matured Portal — streamed chat with token + compaction meter, sessions, workspace files, MCP services, Admin",
      "Per-agent memory — built-in SQLite keyword search, seeded for every agent",
      "Per-user Tool Access — admin allow/deny over built-in + connected-MCP tools via OpenClaw's native tools.deny, on top of always-on cross-user isolation",
    ],
  },
  {
    version: "v0.3",
    status: "Next",
    points: [
      "One-command tenant provisioning — provision-tenant.sh / destroy-tenant.sh (full Northflank tenant lifecycle)",
      "RAGFlow — cited document retrieval behind a stable interface",
      "Semantic memory + embeddings via bge-m3 — on its own GPU card",
      "Scrapling web fetch + a first CRM connector, as MCP services",
      "Voice — VoxCPM2 open-weight cloning + TTS",
      "Image — ComfyUI + SDXL",
      "Cascade routing + TurboQuant turbo4 — 1M-token context on a single card",
    ],
  },
  {
    version: "v0.4+",
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
