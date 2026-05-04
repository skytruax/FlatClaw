import {
  MessageSquare,
  Database,
  Boxes,
  ShieldCheck,
  Cpu,
  Workflow,
  KeyRound,
  Container,
} from "lucide-react";

const features = [
  {
    Icon: MessageSquare,
    title: "FlatClaw Portal",
    body: "Next.js 16 + React 19 product surface. Chat, agent fleet, approvals, cron, skills, Docs (RAGFlow), Memory, Admin (RBAC). SSE-streamed tool use.",
  },
  {
    Icon: Workflow,
    title: "OpenClaw runtime",
    body: "Self-hosted agent loop. Sessions, multi-step planning, sandboxed tool execution, RBAC enforced at every tool call. Owns per-agent memory.",
  },
  {
    Icon: Cpu,
    title: "Inference",
    body: "Patched SGLang + Gemma 4 31B Dense + bge-m3 embedder, co-resident on a single NVIDIA H100 (80 GB, native FP8) on Northflank's managed GPU fleet.",
  },
  {
    Icon: Database,
    title: "Per-agent memory",
    body: "OpenClaw's built-in memory module — each user's agent owns its own markdown memory under its workspace. The agent decides what to remember; admins can prompt updates via a subagent. No separate service.",
  },
  {
    Icon: Boxes,
    title: "Skills library",
    body: "OpenClaw skills bundle. Gmail, Drive, Scrapling, fs-paths, rag-search, CRM. Per-user OAuth credentials, never tenant-wide.",
  },
  {
    Icon: ShieldCheck,
    title: "RBAC + per-user creds",
    body: "Multiple users per tenant, distinct roles, per-role skill policy matrix. Per-user OAuth tokens scoped (tenant, user, service).",
  },
  {
    Icon: Container,
    title: "Single-tenant by design",
    body: "Each customer gets their own Northflank project. Strict isolation, dedicated H100, no shared state across tenants.",
  },
  {
    Icon: KeyRound,
    title: "One image, every tenant",
    body: "ghcr.io/skytruax/flatclaw-inference:latest — public on GHCR, ~18 GB, no baked weights. Every deployment pulls the same image.",
  },
];

export function FeatureGrid() {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {features.map(({ Icon, title, body }) => (
        <div
          key={title}
          className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-5 hover:ring-[hsl(var(--brand-accent))/0.5] transition shadow-sm"
        >
          <div className="w-9 h-9 rounded-md bg-[hsl(var(--brand-accent))/0.15] text-[hsl(var(--brand-primary))] flex items-center justify-center mb-3">
            <Icon className="w-5 h-5" />
          </div>
          <div className="font-semibold text-[hsl(var(--fc-fg-primary))]">
            {title}
          </div>
          <p className="mt-1.5 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">
            {body}
          </p>
        </div>
      ))}
    </div>
  );
}
