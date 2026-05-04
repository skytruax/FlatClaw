import type { Metadata } from "next";
import { Section } from "@/components/Section";
import { Linkedin, Github, Mail } from "lucide-react";

export const metadata: Metadata = {
  title: "About",
  description:
    "FlatClaw is built by Skyler Truax — an engineer focused on private-cloud AI infrastructure for regulated industries.",
};

export default function AboutPage() {
  return (
    <>
      <div className="bg-[hsl(var(--brand-primary))] text-[hsl(var(--brand-accent-fg))]">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))] mb-3">
            About
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Built for the firms cloud-hosted AI can&apos;t reach.
          </h1>
          <p className="mt-5 text-lg max-w-3xl leading-relaxed text-[hsl(var(--brand-accent-fg))/0.9]">
            FlatClaw started as the answer to a recurring conversation: every
            firm under a data-locality constraint — legal, healthcare,
            accounting, finance, government — wanted the same product the
            frontier labs were shipping, and none of them could buy it.
            The whole project exists to close that gap with open source.
          </p>
        </div>
      </div>

      <Section
        eyebrow="Who's behind it"
        title="Skyler Truax"
        lede="Engineer focused on practical agent infrastructure — runtimes, RBAC, deploy automation, and the unsexy plumbing that makes private-cloud AI actually work in production."
      >
        <div className="grid md:grid-cols-[1.5fr_1fr] gap-6">
          <div className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-6 md:p-8">
            <h3 className="font-semibold text-[hsl(var(--fc-fg-primary))]">
              Why FlatClaw
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              The frontier-lab AI coworker product is genuinely useful — task
              inboxes, scheduled work, persistent memory, tool access. It just
              comes with a constraint that disqualifies most of the customers
              who&apos;d benefit from it most: the data has to leave their
              tenancy on every turn.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              FlatClaw is the same shape, built out of components anyone can
              audit, deployed onto infrastructure the customer pays for and
              controls directly. The privacy story is a{" "}
              <code className="font-mono bg-[hsl(var(--fc-bg-tertiary))/0.5] px-1.5 py-0.5 rounded text-xs">
                tcpdump
              </code>{" "}
              away from being verifiable, not a marketing claim.
            </p>

            <h3 className="font-semibold text-[hsl(var(--fc-fg-primary))] mt-6">
              How I work
            </h3>
            <ul className="mt-2 text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))] space-y-2 list-disc pl-5">
              <li>
                Working components first — every release ships with end-to-end
                tests for the features in scope. Silent hangs and unverified
                claims are blockers.
              </li>
              <li>
                Boring substrate, sharp surface — Northflank + established
                open-source for the spine, attention spent on the product the
                user actually touches.
              </li>
              <li>
                Auditable by default — single image, public license, mechanical
                privacy proof, honest roadmap.
              </li>
            </ul>
          </div>

          <div className="bg-[hsl(var(--fc-bg-soft))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-6 flex flex-col">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-primary))] mb-3">
              Get in touch
            </div>
            <a
              href="https://www.linkedin.com/in/skyler-truax-a375518/"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] hover:ring-[hsl(var(--brand-accent))/0.5] transition"
            >
              <Linkedin className="w-5 h-5 text-[hsl(var(--brand-primary))]" />
              <div>
                <div className="font-medium text-[hsl(var(--fc-fg-primary))] text-sm">
                  LinkedIn
                </div>
                <div className="text-xs text-[hsl(var(--fc-fg-muted))]">
                  /in/skyler-truax-a375518
                </div>
              </div>
            </a>
            <a
              href="https://github.com/skytruax/FlatClaw"
              target="_blank"
              rel="noreferrer"
              className="mt-3 flex items-center gap-3 px-4 py-3 rounded-lg bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] hover:ring-[hsl(var(--brand-accent))/0.5] transition"
            >
              <Github className="w-5 h-5 text-[hsl(var(--brand-primary))]" />
              <div>
                <div className="font-medium text-[hsl(var(--fc-fg-primary))] text-sm">
                  GitHub
                </div>
                <div className="text-xs text-[hsl(var(--fc-fg-muted))]">
                  skytruax/FlatClaw
                </div>
              </div>
            </a>
            <a
              href="mailto:hi@flatclaw.org"
              className="mt-3 flex items-center gap-3 px-4 py-3 rounded-lg bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] hover:ring-[hsl(var(--brand-accent))/0.5] transition"
            >
              <Mail className="w-5 h-5 text-[hsl(var(--brand-primary))]" />
              <div>
                <div className="font-medium text-[hsl(var(--fc-fg-primary))] text-sm">
                  Email
                </div>
                <div className="text-xs text-[hsl(var(--fc-fg-muted))]">
                  hi@flatclaw.org
                </div>
              </div>
            </a>
          </div>
        </div>
      </Section>

      <Section
        eyebrow="Open by default"
        title="Apache 2.0, OSI-approved."
        lede={
          <>
            FlatClaw itself is Apache 2.0. The Console is MIT. The inference
            image is public on GHCR. Every line is auditable; the patent
            grant is explicit.
          </>
        }
        variant="soft"
      >
        <p className="text-sm text-[hsl(var(--fc-fg-secondary))] max-w-3xl leading-relaxed">
          Read the LICENSE files in the repo for the full terms. If you
          deploy FlatClaw and find a security issue, see{" "}
          <code className="font-mono text-xs bg-[hsl(var(--fc-bg-tertiary))/0.5] px-1.5 py-0.5 rounded">
            SECURITY.md
          </code>{" "}
          for responsible disclosure. PRs welcome.
        </p>
      </Section>
    </>
  );
}
