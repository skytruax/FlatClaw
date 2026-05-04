import type { Metadata } from "next";
import Image from "next/image";
import { Section } from "@/components/Section";
import { ExternalLink, Wrench, Plug, Boxes } from "lucide-react";

export const metadata: Metadata = {
  title: "Partners",
  description:
    "FlatClaw partners with implementation specialists who build custom AI and MCP integrations on top of the platform.",
};

export default function PartnersPage() {
  return (
    <>
      <div className="bg-[hsl(var(--brand-primary))] text-[hsl(var(--brand-accent-fg))]">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))] mb-3">
            Partners
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Implementation, custom skills, and MCP integrations.
          </h1>
          <p className="mt-5 text-lg max-w-3xl leading-relaxed text-[hsl(var(--brand-accent-fg))/0.9]">
            FlatClaw is the platform. The partners below build the skills,
            integrations, and bespoke workflows that turn it into the
            specific coworker your firm needs.
          </p>
        </div>
      </div>

      <Section eyebrow="Featured partner" title="Kirk Tech Solutions">
        <div className="bg-[hsl(var(--fc-bg-surface))] rounded-2xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] overflow-hidden shadow-sm">
          <div className="grid md:grid-cols-[280px_1fr]">
            <div className="bg-[hsl(var(--fc-bg-soft))] p-8 flex items-center justify-center border-b md:border-b-0 md:border-r border-[hsl(var(--fc-bg-tertiary))]">
              <Image
                src="/partners/kirk-tech-solutions.svg"
                alt="Kirk Tech Solutions"
                width={240}
                height={60}
                className="max-w-[240px] h-auto"
              />
            </div>
            <div className="p-8">
              <h3 className="text-xl font-semibold text-[hsl(var(--fc-fg-primary))]">
                Custom AI & MCP solutions
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
                Kirk Tech Solutions builds custom AI applications and MCP
                (Model Context Protocol) integrations for firms that need
                more than off-the-shelf can offer. They specialize in turning
                domain workflows — the kind that don&apos;t fit a generic
                chat tool — into agent skills that actually move work
                through the door.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
                For FlatClaw deployments, they handle the bespoke
                end-to-end: skill design and implementation, MCP server
                authoring, RBAC policy mapping, and the integration glue
                that connects the platform to whatever the customer
                already runs.
              </p>

              <div className="mt-6 grid sm:grid-cols-3 gap-3">
                <Capability
                  Icon={Wrench}
                  title="Custom AI"
                  body="Bespoke agents, prompts, and pipelines fit to your workflows."
                />
                <Capability
                  Icon={Plug}
                  title="MCP integrations"
                  body="MCP servers that expose your existing systems to agents safely."
                />
                <Capability
                  Icon={Boxes}
                  title="OpenClaw skills"
                  body="Authored, tested, and shipped as skills inside your tenancy."
                />
              </div>

              <div className="mt-7 flex items-center gap-3">
                <a
                  href="https://kirktechsolutions.com"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] px-5 py-2.5 font-semibold hover:brightness-110 transition"
                >
                  Visit kirktechsolutions.com
                  <ExternalLink className="w-4 h-4" />
                </a>
                <span className="text-xs text-[hsl(var(--fc-fg-muted))]">
                  Independent vendor — engagements directly with Kirk Tech.
                </span>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section
        eyebrow="Become a partner"
        title="Building on FlatClaw?"
        lede="If your firm builds custom skills, MCP servers, or implementation services on top of FlatClaw and you'd like to be listed here, get in touch."
        variant="soft"
      >
        <a
          href="mailto:partners@flatclaw.org"
          className="inline-flex items-center gap-2 rounded-md ring-1 ring-[hsl(var(--brand-primary))/0.4] text-[hsl(var(--brand-primary))] px-5 py-2.5 font-medium hover:bg-[hsl(var(--brand-primary))/0.08] transition"
        >
          partners@flatclaw.org
        </a>
      </Section>
    </>
  );
}

function Capability({
  Icon,
  title,
  body,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-[hsl(var(--fc-bg-soft))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] rounded-md p-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-[hsl(var(--brand-primary))]" />
        <div className="font-semibold text-sm text-[hsl(var(--fc-fg-primary))]">
          {title}
        </div>
      </div>
      <p className="text-[12px] text-[hsl(var(--fc-fg-secondary))] mt-1.5 leading-relaxed">
        {body}
      </p>
    </div>
  );
}
