/**
 * The README's ASCII architecture diagram, rendered as a real diagram.
 * Tenant boundary on the outer rounded rectangle; data flow top-down.
 * Everything — control plane and GPU — lives inside the tenant's own
 * cloud tenancy (Azure, AWS, Google Cloud, Northflank, or on-prem).
 */
export function ArchitectureDiagram() {
  return (
    <div className="rounded-2xl bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-4 sm:p-6 md:p-10 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-primary))] mb-4 break-words">
        Customer&apos;s cloud tenancy · one per tenant · Azure / AWS / Google Cloud / Northflank / on-prem
      </div>

      <div className="border-2 border-dashed border-[hsl(var(--brand-primary))/0.35] rounded-xl p-3 sm:p-5 md:p-7 space-y-4 sm:space-y-5">
        <Tier
          label="Browser"
          accent
          aside="The user — an admin or end-user inside the customer's org"
        />
        <Arrow label="HTTPS · cookie-auth" />

        <Tier label="FlatClaw Portal" subtitle="Next.js 16 + React 19 + SQLite">
          <BadgeRow
            items={[
              "Chat",
              "Agents",
              "Approvals",
              "Cron",
              "MCP services",
              "Memory",
              "Admin",
            ]}
          />
        </Tier>
        <Arrow label="server-owned WebSocket · ws://:18789" />

        <Tier
          label="Agent harness"
          subtitle="Built on the minimal open Pi agent core · sessions · tool dispatch · RBAC enforced at every tool call"
        />
        <Arrow label="MCP (per-agent, deny-glob scoped) · per-user Tool Access (native tools.deny)" />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ServiceCard title="Google" tag="Gmail · Calendar · Drive · Docs · Sheets · Contacts" />
          <ServiceCard title="Add-on connectors" tag="CRM · ERP · private services" />
          <ServiceCard title="Jira" tag="Atlassian Cloud" />
          <ServiceCard
            title="Sandbox"
            tag="per-tool exec · per-user scoped credentials"
          />
        </div>

        <div className="text-[11px] text-[hsl(var(--fc-fg-muted))] italic px-1">
          MCP services are first-party servers the agent calls over Model Context
          Protocol; per-user credentials scoped per (tenant, user, service). RBAC
          is the harness&apos;s native per-agent{" "}
          <code className="font-mono text-[hsl(var(--fc-fg-secondary))]">
            tools.deny
          </code>{" "}
          — always-on cross-user roster isolation (each agent sees only its own
          servers&apos; tools) plus a per-user Tool Access panel that toggles
          built-in and MCP tools off; denied tools are filtered from the roster
          before the model sees them.
        </div>

        <div className="text-[11px] text-[hsl(var(--fc-fg-muted))] italic px-1">
          Per-agent memory uses the harness&apos;s built-in per-agent SQLite engine —
          keyword (BM25) search over each agent&apos;s{" "}
          <code className="font-mono text-[hsl(var(--fc-fg-secondary))]">
            MEMORY.md
          </code>{" "}
          + memory/ files. Semantic recall via bge-m3 (on its own GPU card) and
          RAGFlow cited-document retrieval land in v0.4.
        </div>

        <Arrow label="internal tenancy network · TLS · bearer-authenticated" />

        <div className="bg-[hsl(var(--brand-primary))/0.08] rounded-lg p-4 ring-1 ring-[hsl(var(--brand-primary))/0.20]">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-primary))] mb-2">
            Inference (GPU) · same tenancy
          </div>
          <Tier
            label="Inference service"
            subtitle="Patched SGLang · Gemma 4 31B-IT (FP8) · 256K context · NVIDIA H100 (80 GB · sm_90 · native FP8)"
          />
          <div className="mt-3 text-xs text-[hsl(var(--fc-fg-muted))]">
            Weights served by the in-project{" "}
            <code className="font-mono text-[hsl(var(--fc-fg-secondary))]">
              weights-server
            </code>{" "}
            pod over a tenancy-local volume — staged once, never moved at boot.
          </div>
        </div>
      </div>

      <div className="mt-6 grid sm:grid-cols-3 gap-3 text-xs">
        <Footnote
          title="No vendor egress"
          body="Zero packets to Anthropic, OpenAI, Google AI, Hugging Face, ElevenLabs, or any third-party inference endpoint. Verifiable with tcpdump."
        />
        <Footnote
          title="Customer holds the account"
          body="Customer's own cloud account — Azure, AWS, Google Cloud, Northflank, or their own hardware — billed directly to them. We never touch the bill or the data."
        />
        <Footnote
          title="One image, every tenant"
          body="ghcr.io/skytruax/flatclaw-inference:latest. SGLang base + entrypoint, no baked weights. Public, auditable, reproducible."
        />
      </div>
    </div>
  );
}

function Tier({
  label,
  subtitle,
  aside,
  accent,
  children,
}: {
  label: string;
  subtitle?: string;
  aside?: string;
  accent?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={
        "rounded-lg p-4 " +
        (accent
          ? "bg-[hsl(var(--brand-accent))/0.15] ring-1 ring-[hsl(var(--brand-accent))/0.4]"
          : "bg-[hsl(var(--fc-bg-soft))] ring-1 ring-[hsl(var(--fc-bg-tertiary))]")
      }
    >
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 sm:gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-[hsl(var(--fc-fg-primary))]">
            {label}
          </div>
          {subtitle && (
            <div className="text-xs text-[hsl(var(--fc-fg-muted))] mt-0.5 break-words">
              {subtitle}
            </div>
          )}
        </div>
        {aside && (
          <div className="text-[11px] text-[hsl(var(--fc-fg-muted))] italic sm:shrink-0">
            {aside}
          </div>
        )}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

function BadgeRow({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <span
          key={it}
          className="text-[11px] px-2 py-0.5 rounded bg-[hsl(var(--brand-primary))/0.10] text-[hsl(var(--brand-primary))] font-medium"
        >
          {it}
        </span>
      ))}
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pl-2 sm:pl-4">
      <div className="w-px h-6 bg-[hsl(var(--fc-bg-tertiary))] shrink-0" />
      <span className="text-[10.5px] font-mono text-[hsl(var(--fc-fg-muted))] break-words min-w-0">
        ↓ {label}
      </span>
    </div>
  );
}

function ServiceCard({ title, tag }: { title: string; tag: string }) {
  return (
    <div className="bg-[hsl(var(--fc-bg-soft))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] rounded-md p-3">
      <div className="font-semibold text-sm text-[hsl(var(--fc-fg-primary))]">
        {title}
      </div>
      <div className="text-[10.5px] text-[hsl(var(--fc-fg-muted))] mt-1 leading-relaxed">
        {tag}
      </div>
    </div>
  );
}

function Footnote({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-[hsl(var(--fc-bg-soft))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] rounded-md p-3">
      <div className="font-semibold text-[hsl(var(--fc-fg-primary))]">{title}</div>
      <div className="text-[hsl(var(--fc-fg-muted))] mt-1 leading-relaxed">
        {body}
      </div>
    </div>
  );
}
