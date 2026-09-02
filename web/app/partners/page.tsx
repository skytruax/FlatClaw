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
  title: "Cloud partners",
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
            Deploy on the cloud you already trust.
          </h1>
          <p className="mt-5 text-lg max-w-3xl leading-relaxed text-[hsl(var(--brand-accent-fg))/0.9]">
            FlatClaw is a set of containers and one GPU node. It runs wherever
            those exist, so a customer keeps their existing cloud account,
            their contracts, and their compliance posture. We partner across the
            major clouds for the substrate, and with implementation firms for
            the skills and integrations that make the coworker theirs.
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

      <Section
        id="clouds"
        eyebrow="Cloud partners"
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
                workflows that turn FlatClaw into the specific coworker a firm
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
                <a
                  href={KIRK_PRESS_RELEASE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-md ring-1 ring-[hsl(var(--brand-primary))/0.4] text-[hsl(var(--brand-primary))] px-4 py-2.5 text-sm font-medium hover:bg-[hsl(var(--brand-primary))/0.06] transition"
                >
                  <Megaphone className="w-4 h-4" />
                  Launch press release
                </a>
              </div>
            </div>
          </div>
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
