/**
 * The README's ASCII architecture diagram, rendered as a real diagram.
 * Tenant boundary on the outer rounded rectangle; data flow top-down.
 * Everything — control plane and GPU — lives inside the tenant's
 * Northflank project.
 */
export function ArchitectureDiagram() {
  return (
    <div className="rounded-2xl bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-6 md:p-10 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-primary))] mb-4">
        Customer&apos;s Northflank project · one per tenant
      </div>

      <div className="border-2 border-dashed border-[hsl(var(--brand-primary))/0.35] rounded-xl p-5 md:p-7 space-y-5">
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
              "Skills",
              "Docs",
              "Memory",
              "Admin",
            ]}
          />
        </Tier>
        <Arrow label="server-owned WebSocket · ws://:18789" />

        <Tier
          label="OpenClaw Gateway"
          subtitle="Agent runtime · sessions · tool dispatch · RBAC"
        />
        <Arrow label="local IPC / HTTP — skills bus" />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ServiceCard title="Postgres" tag="optional" />
          <ServiceCard title="RAGFlow" tag="docs in · cited answers" />
          <ServiceCard
            title="Skills"
            tag="gmail · gdrive · scrapling · rag · memory · fs-paths"
          />
          <ServiceCard
            title="Sandbox"
            tag="podman per-tool exec · scoped credentials"
          />
        </div>

        <div className="text-[11px] text-[hsl(var(--fc-fg-muted))] italic px-1">
          Per-agent memory lives inside each agent&apos;s workspace
          (~/.openclaw/workspace-&lt;id&gt;/memory/) — managed by OpenClaw itself.
        </div>

        <Arrow label="internal Northflank network · TLS · bearer-authenticated" />

        <div className="bg-[hsl(var(--brand-primary))/0.08] rounded-lg p-4 ring-1 ring-[hsl(var(--brand-primary))/0.20]">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-primary))] mb-2">
            Inference (GPU) · same Northflank project
          </div>
          <Tier
            label="Inference service"
            subtitle="Patched SGLang · Gemma 4 31B · bge-m3 · NVIDIA H100 (80 GB · sm_90 · native FP8)"
          />
          <div className="mt-3 text-xs text-[hsl(var(--fc-fg-muted))]">
            Weights served by the in-project{" "}
            <code className="font-mono text-[hsl(var(--fc-fg-secondary))]">
              weights-server
            </code>{" "}
            pod over a Northflank-managed volume — staged once via Kaggle, never moved at boot.
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
          body="Customer's own Northflank account, billed directly to them. We never touch the bill or the data. No second cloud, no BYOC plumbing."
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
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="font-semibold text-[hsl(var(--fc-fg-primary))]">
            {label}
          </div>
          {subtitle && (
            <div className="text-xs text-[hsl(var(--fc-fg-muted))] mt-0.5">
              {subtitle}
            </div>
          )}
        </div>
        {aside && (
          <div className="text-[11px] text-[hsl(var(--fc-fg-muted))] italic shrink-0">
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
    <div className="flex items-center gap-3 pl-4">
      <div className="w-px h-6 bg-[hsl(var(--fc-bg-tertiary))]" />
      <span className="text-[10.5px] font-mono text-[hsl(var(--fc-fg-muted))]">
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
