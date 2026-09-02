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
    body: "Next.js 16 + React 19 product surface. Chat, agent fleet, approvals, cron, MCP services, workspace files, Memory, Admin (RBAC). SSE-streamed tool use.",
  },
  {
    Icon: Workflow,
    title: "Agent harness",
    body: "Built on the minimal open Pi agent core. Sessions, multi-step planning, sandboxed tool execution, RBAC enforced at every tool call, scheduling and approvals above it. Owns per-agent memory.",
  },
  {
    Icon: Cpu,
    title: "Inference",
    body: "Patched SGLang + Gemma 4 31B Dense on a single NVIDIA H100-class GPU (80 GB, native FP8) inside the customer's own tenancy, served at the model's native 256K context.",
  },
  {
    Icon: Database,
    title: "Per-agent memory",
    body: "The harness's built-in per-agent SQLite memory — keyword (BM25) search over each agent's MEMORY.md and memory/ files, seeded automatically for every agent. The agent maintains it across sessions. Semantic recall via bge-m3 lands in v0.4.",
  },
  {
    Icon: Boxes,
    title: "MCP services",
    body: "First-party Model Context Protocol servers: Google (Gmail/Calendar/Drive/Docs/Sheets) and Jira, plus private add-on connectors through the same plugin registry. Consequential actions pause for human approval and replay with the user's own credentials. Per-user credentials scoped (tenant, user, service), never tenant-wide.",
  },
  {
    Icon: ShieldCheck,
    title: "RBAC + per-user creds",
    body: "Multiple users per tenant. Per-user Tool Access (allow/deny over built-in + MCP tools) on the harness's native tool policy, plus always-on cross-user isolation. Per-user credentials scoped (tenant, user, service).",
  },
  {
    Icon: Container,
    title: "Single-tenant by design",
    body: "Each customer gets their own tenancy — an Azure resource group, an AWS account, a Google Cloud project, a Northflank project, or an on-prem cluster. Strict isolation, dedicated GPU, no shared state across tenants.",
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
          <div className="w-9 h-9 rounded-md bg-[hsl(var(--brand-accent))/0.12] text-[hsl(var(--brand-accent-deep))] flex items-center justify-center mb-3">
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
