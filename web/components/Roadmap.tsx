const milestones = [
  {
    version: "v0.1.0",
    status: "Shipped",
    points: [
      "Full architecture documented",
      "FlatClaw Portal — runnable Next.js 16 + React 19 admin + user surface",
      "Per-agent memory via OpenClaw — workspace-owned, no separate service",
      "Public inference image on GHCR — SGLang base + entrypoint, GitHub Actions on every change",
      "Apache 2.0 license, OSI-approved",
    ],
  },
  {
    version: "v0.2",
    status: "Next release",
    points: [
      "Skill implementations: Gmail, Google Drive, Scrapling, fs-paths, rag-search, first CRM",
      "RAGFlow service manifest + per-tenant ingest watcher daemon",
      "RBAC vault enforcement at the OpenClaw tool-invocation hook",
      "provision-tenant.sh + destroy-tenant.sh — full Northflank tenant lifecycle",
      "Portal Admin panel: invite, role policy editor, audit-log viewer",
    ],
  },
  {
    version: "v0.3",
    status: "Planned",
    points: [
      "Voice — VoxCPM2 open-weight cloning + TTS, co-resident on the H100",
      "Image — ComfyUI + SDXL with the same volume-staging pattern",
      "Cascade routing — small + large Gemma + voice + image co-resident under one GPU",
      "TurboQuant turbo4 KV compression — 1M-token context on a single card",
    ],
  },
  {
    version: "v0.4+",
    status: "Future",
    points: [
      "WorkOS SSO for v2 enterprise tenants (Okta / Azure AD / Google Workspace)",
      "Multi-tenancy on a shared GPU node for the SMB tier",
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
