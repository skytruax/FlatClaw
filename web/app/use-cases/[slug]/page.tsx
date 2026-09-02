import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, ShieldCheck } from "lucide-react";
import { Section } from "@/components/Section";
import { SpotlightCard } from "@/components/SpotlightCard";
import { SPOTLIGHTS } from "@/lib/useCases";
import { SPOTLIGHT_DETAILS } from "@/lib/useCaseDetails";
import { SCHEDULE_DEMO_URL } from "@/lib/site";

// Static export: every spotlight becomes /use-cases/<slug>/index.html.
export const dynamicParams = false;

export function generateStaticParams() {
  return SPOTLIGHTS.map((s) => ({ slug: s.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const s = SPOTLIGHTS.find((x) => x.id === slug);
  if (!s) return { title: "Use case spotlight" };
  return {
    title: `${s.title} — ${s.useCase}`,
    description: s.results,
  };
}

export default async function SpotlightPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const s = SPOTLIGHTS.find((x) => x.id === slug);
  const d = SPOTLIGHT_DETAILS[slug];
  if (!s || !d) notFound();

  const related = SPOTLIGHTS.filter(
    (x) =>
      x.id !== s.id &&
      (x.industries.some((i) => s.industries.includes(i)) ||
        x.useCases.some((u) => s.useCases.includes(u))),
  ).slice(0, 3);

  const ground = `linear-gradient(160deg, hsl(${s.hue} 40% 18%) 0%, hsl(${s.hue + 10} 55% 28%) 70%, hsl(${s.hue + 18} 70% 36%) 100%)`;

  return (
    <>
      <div
        className="relative text-white overflow-hidden"
        style={{ background: `radial-gradient(ellipse at 85% 10%, hsl(204 100% 50% / 0.35), transparent 55%), ${ground}` }}
      >
        <div className="mx-auto max-w-6xl px-5 py-14 md:py-20">
          <Link
            href="/use-cases"
            className="inline-flex items-center gap-1.5 text-sm text-white/80 hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
            All use case spotlights
          </Link>
          <div className="mt-6 flex flex-wrap gap-1.5">
            {[...s.useCases, ...s.industries].map((t) => (
              <span
                key={t}
                className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/12 ring-1 ring-white/20"
              >
                {t}
              </span>
            ))}
          </div>
          <h1 className="mt-5 text-3xl md:text-5xl font-bold tracking-tight max-w-4xl">
            {s.title}
          </h1>
          <p className="mt-3 text-lg md:text-2xl font-medium text-[hsl(var(--brand-accent))] max-w-3xl">
            {s.useCase}
          </p>
          <p className="mt-5 text-base md:text-lg max-w-3xl leading-relaxed text-white/90">
            {s.results}
          </p>
        </div>
      </div>

      <section className="bg-[hsl(var(--fc-bg-primary))] border-b border-[hsl(var(--fc-bg-tertiary))]">
        <div className="mx-auto max-w-6xl px-5 py-8">
          <dl className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {d.facts.map(([k, v]) => (
              <div
                key={k}
                className="bg-[hsl(var(--fc-bg-surface))] rounded-lg ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-4"
              >
                <dt className="text-[10.5px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent-deep))]">
                  {k}
                </dt>
                <dd className="mt-1 text-sm text-[hsl(var(--fc-fg-primary))] leading-relaxed">
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <Section eyebrow="The situation" title="Where they started.">
        <p className="text-base md:text-lg leading-relaxed text-[hsl(var(--fc-fg-secondary))] max-w-3xl">
          {d.situation}
        </p>
      </Section>

      <Section
        eyebrow="What FlatClaw does"
        title="What was built."
        variant="soft"
      >
        <ul className="grid md:grid-cols-2 gap-4">
          {d.solution.map((line) => (
            <li
              key={line}
              className="flex gap-3 bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-5"
            >
              <span className="shrink-0 w-7 h-7 rounded-full bg-[hsl(var(--brand-accent))/0.12] text-[hsl(var(--brand-accent-deep))] flex items-center justify-center">
                <Check className="w-4 h-4" />
              </span>
              <span className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
                {line}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section eyebrow="Results" title="What changed.">
        <div className="grid md:grid-cols-[1.4fr_1fr] gap-6">
          <ul className="space-y-3">
            {d.outcomes.map((line) => (
              <li key={line} className="flex gap-3 items-start">
                <span className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-[hsl(var(--brand-accent))] text-white flex items-center justify-center">
                  <Check className="w-3.5 h-3.5" />
                </span>
                <span className="text-base leading-relaxed text-[hsl(var(--fc-fg-primary))]">
                  {line}
                </span>
              </li>
            ))}
          </ul>
          <div className="bg-[hsl(var(--brand-primary))] text-white rounded-xl p-6">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))]">
              <ShieldCheck className="w-4 h-4" />
              Why private
            </div>
            <p className="mt-3 text-sm leading-relaxed text-white/90">
              {d.whyPrivate}
            </p>
            <div className="mt-5 text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))]">
              Runs on
            </div>
            <p className="mt-1 text-sm text-white/90">{d.runsOn}</p>
          </div>
        </div>
      </Section>

      <Section
        eyebrow="The stack"
        title="Components involved."
        variant="soft"
      >
        <div className="flex flex-wrap gap-2">
          {d.stack.map((t) => (
            <span
              key={t}
              className="rounded-full px-4 py-2 text-sm font-medium bg-[hsl(var(--fc-bg-surface))] text-[hsl(var(--fc-fg-primary))] ring-1 ring-[hsl(var(--fc-bg-tertiary))]"
            >
              {t}
            </span>
          ))}
        </div>
      </Section>

      {related.length > 0 && (
        <Section eyebrow="Related spotlights" title="More like this.">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((r) => (
              <SpotlightCard key={r.id} s={r} />
            ))}
          </div>
        </Section>
      )}

      <Section
        eyebrow="Your workflow"
        title="Have one like it?"
        lede="Every spotlight started as a conversation about a process nobody liked doing, under a data-locality constraint."
        variant="dark"
      >
        <div className="flex flex-wrap gap-3">
          <a
            href={SCHEDULE_DEMO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-md bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] px-5 py-2.5 font-semibold hover:brightness-110 transition"
          >
            Schedule a demo
          </a>
          <Link
            href="/use-cases"
            className="inline-flex items-center rounded-md ring-1 ring-[hsl(var(--brand-accent-fg))/0.3] px-5 py-2.5 font-medium hover:bg-[hsl(var(--brand-accent-fg))/0.08] transition"
          >
            Browse all spotlights
          </Link>
        </div>
      </Section>
    </>
  );
}
