import type { Metadata } from "next";
import Image from "next/image";
import { Section } from "@/components/Section";
import { CloudGrid } from "@/components/CloudGrid";
import { ExternalLink, Wrench, Plug, Boxes, Megaphone } from "lucide-react";
import { SHARED_GUARANTEES } from "@/lib/clouds";
import {
  KIRK_PRESS_RELEASE_URL,
  KIRK_SITE_URL,
  SCHEDULE_DEMO_URL,
  PARTNERS_EMAIL,
} from "@/lib/site";

export const metadata: Metadata = {
  title: "Partners",
  description:
    "FlatClaw deploys into the customer's own tenancy on Microsoft Azure, AWS, Google Cloud, Northflank, or bare metal, delivered with implementation partners who build the skills and integrations.",
};

export default function PartnersPage() {
  return (
    <>
      <div className="bg-[hsl(var(--brand-primary))] text-[hsl(var(--brand-accent-fg))]">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))] mb-3">
            Partners
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight max-w-4xl">
            Implementation partners, custom skills, and the clouds they deliver on.
          </h1>
          <p className="mt-5 text-lg max-w-3xl leading-relaxed text-[hsl(var(--brand-accent-fg))/0.9]">
            FlatClaw is the platform. Implementation partners build the skills,
            MCP servers and bespoke workflows that turn it into the specific
            solution a firm needs, and deliver the tenancy on the cloud the
            customer already trusts: Azure, AWS, Google Cloud, Northflank, or
            their own hardware.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={`mailto:${PARTNERS_EMAIL}`}
              className="inline-flex items-center rounded-md bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] px-5 py-2.5 font-semibold hover:brightness-110 transition"
            >
              Become a partner
            </a>
            <a
              href={SCHEDULE_DEMO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md ring-1 ring-[hsl(var(--brand-accent-fg))/0.3] px-5 py-2.5 font-medium hover:bg-[hsl(var(--brand-accent-fg))/0.08] transition"
            >
              Schedule a demo
            </a>
          </div>
        </div>
      </div>

      <Section eyebrow="Announcement" title="Kirk Tech Solutions launches FlatClaw">
        <div className="bg-[hsl(var(--brand-primary))/0.06] rounded-2xl ring-1 ring-[hsl(var(--brand-primary))/0.25] p-6 md:p-8">
          <div className="flex items-start gap-4">
            <div className="shrink-0 w-10 h-10 rounded-full bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] flex items-center justify-center">
              <Megaphone className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
                Kirk Tech Solutions has announced the launch of FlatClaw: a
                private, secure, single-tenant AI platform deployed inside
                customers&apos; own private cloud. The release marks the first
                wave of FlatClaw deployments, with Kirk Tech delivering the
                integration, custom skills, and MCP services that turn the
                open-source platform into working solutions for each customer.
              </p>
              <a
                href={KIRK_PRESS_RELEASE_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-md ring-1 ring-[hsl(var(--brand-primary))/0.4] text-[hsl(var(--brand-primary))] px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--brand-primary))/0.08] transition"
              >
                Read the press release
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </Section>

      <Section eyebrow="Implementation partners" title="Kirk Tech Solutions">
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
                Custom AI, MCP integrations, and cloud delivery
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
                Kirk Tech Solutions builds the skills, MCP servers and bespoke
                workflows that turn FlatClaw into the specific solution a firm
                needs, and delivers the tenancy on the customer&apos;s cloud of
                choice: Azure, AWS, Google Cloud, Northflank, or a rack in the
                building.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
                For each deployment they handle the end-to-end: skill design and
                implementation, MCP server authoring, RBAC policy mapping,
                approval-gate configuration, and the integration glue that
                connects the platform to whatever the customer already runs.
              </p>

              <div className="mt-6 grid sm:grid-cols-3 gap-3">
                <Capability
                  Icon={Wrench}
                  title="Custom AI"
                  body="Bespoke agents, prompts, voice loops and pipelines fit to your workflows."
                />
                <Capability
                  Icon={Plug}
                  title="MCP integrations"
                  body="MCP servers that expose your existing systems to agents safely."
                />
                <Capability
                  Icon={Boxes}
                  title="Cloud delivery"
                  body="The tenancy provisioned in your account, on the cloud you already run."
                />
              </div>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <a
                  href={KIRK_SITE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--brand-accent-deep))] text-white px-5 py-2.5 font-semibold hover:bg-[hsl(var(--brand-accent))] transition"
                >
                  Visit kirktechsolutions.com
                  <ExternalLink className="w-4 h-4" />
                </a>
                <span className="text-xs text-[hsl(var(--fc-fg-muted))]">
                  Independent vendor. Engagements are directly with Kirk Tech.
                </span>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section
        id="clouds"
        eyebrow="Technology alliances"
        title="One tenancy per customer, on any of these."
        lede="The same public inference image, the same control plane, the same privacy proof. What changes per cloud is the account it lives in and who provisions it."
      >
        <CloudGrid />
        <p className="mt-6 text-sm text-[hsl(var(--fc-fg-muted))] leading-relaxed max-w-3xl">
          Northflank is the reference lane: the lane scripts in the repository
          bring a tenant up and down today, and every release is verified there
          first. Azure, AWS and Google Cloud tenancies are delivered with an
          implementation partner using the same containers; one-command
          provisioning for those lanes is on the roadmap.
        </p>
      </Section>

      <Section
        eyebrow="What every lane shares"
        title="The part that does not change per cloud."
        variant="soft"
      >
        <div className="grid sm:grid-cols-2 gap-4">
          {SHARED_GUARANTEES.map(([k, v]) => (
            <div
              key={k}
              className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-5"
            >
              <div className="font-semibold text-[hsl(var(--fc-fg-primary))]">
                {k}
              </div>
              <p className="mt-1.5 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">
                {v}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        eyebrow="Become a partner"
        title="Building on FlatClaw, or hosting it?"
        lede="Cloud providers, GPU platforms, and implementation firms that deploy FlatClaw or build skills, MCP servers and services on top of it can be listed here."
        variant="soft"
      >
        <a
          href={`mailto:${PARTNERS_EMAIL}`}
          className="inline-flex items-center gap-2 rounded-md ring-1 ring-[hsl(var(--brand-primary))/0.4] text-[hsl(var(--brand-primary))] px-5 py-2.5 font-medium hover:bg-[hsl(var(--brand-primary))/0.06] transition"
        >
          {PARTNERS_EMAIL}
        </a>
      </Section>

      <Section
        eyebrow="Meet with FlatClaw"
        title="Let us help you deliver your next AI project on infrastructure you own."
        lede="Thirty minutes: your workflow, your cloud, and whether a private AI platform is the right fit for it."
        variant="dark"
      >
        <a
          href={SCHEDULE_DEMO_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-md bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] px-5 py-2.5 font-semibold hover:brightness-110 transition"
        >
          Schedule a meeting
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
        <Icon className="w-4 h-4 text-[hsl(var(--brand-accent-deep))]" />
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
