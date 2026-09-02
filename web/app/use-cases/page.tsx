import type { Metadata } from "next";
import { Section } from "@/components/Section";
import { UseCaseExplorer } from "@/components/UseCaseExplorer";
import { SCHEDULE_DEMO_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Use case spotlights",
  description:
    "What a Private AI Platform actually does: anonymized spotlights of FlatClaw workflows across industries, filterable by use case and industry.",
};

export default function UseCasesPage() {
  return (
    <>
      <div className="bg-[hsl(var(--brand-primary))] text-[hsl(var(--brand-accent-fg))]">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))] mb-3">
            Use case spotlights
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight max-w-4xl">
            Real work, inside your own tenancy.
          </h1>
          <p className="mt-5 text-lg max-w-3xl leading-relaxed text-[hsl(var(--brand-accent-fg))/0.9]">
            Manufacturers, franchisors, law firms, agencies and lenders use
            FlatClaw to answer the phone, consolidate the books, gate the
            risky send, and read the drawings — with the model, the data and
            the audit trail inside infrastructure they own. Each spotlight
            below is one of those workflows: the situation, what was built,
            and what changed. Organizations are described, not named, and
            the revenue and headcount figures are public-source estimates,
            rounded so they stay that way.
          </p>
        </div>
      </div>

      <section className="bg-[hsl(var(--fc-bg-primary))]">
        <div className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
          <UseCaseExplorer />
        </div>
      </section>

      <Section
        eyebrow="Your workflow"
        title="Don't see yours?"
        lede="Most of these started as a conversation about a process nobody liked doing. If yours is under a data-locality constraint, it is probably a fit."
        variant="dark"
      >
        <a
          href={SCHEDULE_DEMO_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-md bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] px-5 py-2.5 font-semibold hover:brightness-110 transition"
        >
          Schedule a demo
        </a>
      </Section>
    </>
  );
}
