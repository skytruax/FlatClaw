import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Section } from "@/components/Section";
import { CloudGrid } from "@/components/CloudGrid";
import {
  ExternalLink,
  Rocket,
  Calculator,
  Database,
  Phone,
  Plug,
  LifeBuoy,
  Megaphone,
  Check,
} from "lucide-react";
import { SHARED_GUARANTEES } from "@/lib/clouds";
import { KIRK_PRESS_RELEASE_URL, KIRK_SITE_URL, SCHEDULE_DEMO_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Services",
  description:
    "FlatClaw is built and delivered by Kirk Tech Solutions: deployment in your own cloud tenancy, custom skills and MCP integrations, estimating engines, data lakehouses, voice agents, and managed operations.",
};

const SERVICES = [
  {
    Icon: Rocket,
    title: "Deployment in your tenancy",
    body: "The platform stood up inside your Azure, AWS or Google Cloud account, your Northflank project, or your own hardware: identity, networking, GPU inference, backups, and the privacy proof run on your egress.",
  },
  {
    Icon: Calculator,
    title: "Estimating and quoting engines",
    body: "Takeoff from drawings and specifications, reconciliation against your proposals, pricing on your rules, benchmarks from your job history, and proposals in your house format.",
  },
  {
    Icon: Database,
    title: "Data lakehouses and reporting",
    body: "Governed lakehouses over your ERPs and CRM with lineage to the source transaction, consolidated financials, forecast and pipeline by business unit, and plain-English inquiry on top.",
  },
  {
    Icon: Phone,
    title: "Voice agents",
    body: "Two-way phone agents on your own lines, with speech, reasoning and recordings inside your tenancy, sized for the concurrency your call volume actually needs.",
  },
  {
    Icon: Plug,
    title: "Custom skills and MCP integrations",
    body: "Model Context Protocol servers that expose your systems to agents safely, per-user credentials, approval gates on consequential actions, and skills authored for the work your teams do.",
  },
  {
    Icon: LifeBuoy,
    title: "Managed operations and support",
    body: "Certified releases and security patches on a cadence you approve, monitoring, backups, capacity, an audit pack, and a named team with business-hours response.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Discovery",
    time: "Two to three weeks, fixed scope",
    body: "We map your systems, identity, data and the first workflows, and come back with a priced plan. Where an unknown cannot be priced responsibly, discovery is where it gets retired.",
  },
  {
    n: "02",
    title: "Phase 0: a working deployment",
    time: "About six weeks",
    body: "The platform stands up in your tenancy on your cloud. First users sign in with your identity provider, the first connectors and skills go live, and you see value before the larger build starts.",
  },
  {
    n: "03",
    title: "Phased build, paid on acceptance",
    time: "Monthly milestones",
    body: "Each milestone is scoped with your team and accepted against agreed outcomes before it is billed. Value first, finesse last.",
  },
  {
    n: "04",
    title: "Run",
    time: "Annual platform subscription",
    body: "Per inference tenant: certified releases, security patches, monitoring, backups and support. Your cloud bills you directly for the infrastructure. We never sit in that bill.",
  },
];

export default function ServicesPage() {
  return (
    <>
      <div className="bg-[hsl(var(--brand-primary))] text-[hsl(var(--brand-accent-fg))]">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))] mb-3">
            Services
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight max-w-4xl">
            One platform. One team that delivers it.
          </h1>
          <p className="mt-5 text-lg max-w-3xl leading-relaxed text-[hsl(var(--brand-accent-fg))/0.9]">
            FlatClaw is built and delivered by Kirk Tech Solutions. Kirk stands
            the platform up in your own cloud tenancy, builds the skills,
            connectors and agents your work needs, and runs it with you. No
            resellers, no hand-offs, one team from the first call to
            production.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={SCHEDULE_DEMO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] px-5 py-2.5 font-semibold hover:brightness-110 transition"
            >
              Schedule a call
            </a>
            <Link
              href="/use-cases"
              className="inline-flex items-center rounded-md ring-1 ring-[hsl(var(--brand-accent-fg))/0.3] px-5 py-2.5 font-medium hover:bg-[hsl(var(--brand-accent-fg))/0.08] transition"
            >
              See the use cases
            </Link>
          </div>
        </div>
      </div>

      <Section
        id="what"
        eyebrow="What Kirk delivers"
        title="Everything between the repository and a platform in production."
        lede="The open-source platform is free to pull and audit. Kirk turns it into your platform: deployed, integrated, taught your work, and kept running."
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SERVICES.map(({ Icon, title, body }) => (
            <div
              key={title}
              className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-6 shadow-sm hover:ring-[hsl(var(--brand-accent))/0.5] transition"
            >
              <div className="w-10 h-10 rounded-md bg-[hsl(var(--brand-accent))/0.12] text-[hsl(var(--brand-accent-deep))] flex items-center justify-center mb-4">
                <Icon className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-lg text-[hsl(var(--fc-fg-primary))] leading-snug">
                {title}
              </h3>
              <p className="mt-2 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">
                {body}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="engagement"
        eyebrow="How an engagement runs"
        title="Fixed scope, value in weeks, milestones paid on acceptance."
        lede="Every engagement follows the same shape, from a two-person team to a multi-brand group. Pricing is fixed per phase and quoted after discovery. Nothing is metered per token or per seat."
        variant="soft"
      >
        <ol className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS.map((s) => (
            <li
              key={s.n}
              className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-6 flex flex-col"
            >
              <div className="text-3xl font-bold text-[hsl(var(--brand-accent))] tracking-tight">
                {s.n}
              </div>
              <h3 className="mt-3 font-semibold text-[hsl(var(--fc-fg-primary))] leading-snug">
                {s.title}
              </h3>
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent-deep))]">
                {s.time}
              </div>
              <p className="mt-3 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">
                {s.body}
              </p>
            </li>
          ))}
        </ol>
        <ul className="mt-8 grid sm:grid-cols-3 gap-3">
          {[
            "Your cloud, your account, your bill for the infrastructure.",
            "Your data and the model never leave the tenancy; the proof runs on your egress.",
            "Every line of the platform is open source and yours to read.",
          ].map((t) => (
            <li
              key={t}
              className="flex items-start gap-2.5 text-sm text-[hsl(var(--fc-fg-primary))]"
            >
              <Check className="w-4 h-4 mt-0.5 shrink-0 text-[hsl(var(--brand-accent))]" />
              {t}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="clouds"
        eyebrow="Where we deliver"
        title="Your cloud, our delivery."
        lede="One image, one control plane, one privacy proof, on whichever cloud you already run. Northflank is the reference lane the platform is built and verified on; Azure, AWS and Google Cloud tenancies are stood up by Kirk in your account."
      >
        <CloudGrid />
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

      <Section eyebrow="Who delivers it" title="Kirk Tech Solutions">
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
                The company behind FlatClaw
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
                Kirk Tech Solutions builds custom AI applications and Model
                Context Protocol integrations for organizations whose data
                cannot leave their own infrastructure. FlatClaw is the
                platform that came out of that work, released as open source
                and delivered by the team that wrote it.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
                For each deployment Kirk handles the end-to-end: discovery,
                the tenancy on your cloud, skill design and implementation,
                MCP server authoring, role and approval policy, integration
                with the systems you already run, and the operations that
                keep it in production.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
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
        eyebrow="Bring a workload"
        title="Thirty minutes: your workflow, your cloud, and a plan."
        lede="Tell us the process nobody likes doing and where the data has to stay. We will tell you what Phase 0 looks like."
        variant="dark"
      >
        <a
          href={SCHEDULE_DEMO_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-md bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] px-5 py-2.5 font-semibold hover:brightness-110 transition"
        >
          Schedule a call
        </a>
      </Section>
    </>
  );
}
