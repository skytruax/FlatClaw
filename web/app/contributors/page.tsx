import type { Metadata } from "next";
import { Section } from "@/components/Section";
import { Linkedin, Github, ExternalLink } from "lucide-react";
import { GITHUB_URL, KIRK_SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contributors",
  description:
    "The people and open-source projects behind FlatClaw — maintainers, partners, and the upstream software the platform is built on.",
};

interface Person {
  name: string;
  role: string;
  links: { kind: "linkedin" | "github" | "site"; href: string; label: string }[];
}

const people: Person[] = [
  {
    name: "Skyler Truax",
    role: "Creator & maintainer — architecture, portal, inference, infra.",
    links: [
      { kind: "github", href: "https://github.com/skytruax", label: "github.com/skytruax" },
    ],
  },
  {
    name: "Kirk Tech Solutions",
    role: "Delivery partner — implementation, custom skills, and MCP integrations for FlatClaw deployments.",
    links: [
      { kind: "site", href: KIRK_SITE_URL, label: "kirktechsolutions.com" },
    ],
  },
  {
    name: "Sebastian Casey",
    role: "Video editing — the FlatClaw demo video.",
    links: [
      {
        kind: "linkedin",
        href: "https://www.linkedin.com/in/sebastianncasey/",
        label: "linkedin.com/in/sebastianncasey",
      },
    ],
  },
];

const builtOn: [string, string, string][] = [
  ["OpenClaw", "Self-hosted agent runtime — sessions, tool use, cron, approvals, RBAC, per-agent memory.", "Apache 2.0"],
  ["SGLang", "Production inference runtime — FP8, RadixAttention prefix caching.", "Apache 2.0"],
  ["Gemma 4 (Google)", "Open-weight LLM — 31B-IT dense, 256K context.", "Gemma Terms"],
  ["RAGFlow", "Document ingest & retrieval with cited answers.", "Apache 2.0"],
  ["bge-m3 (BAAI)", "Multilingual long-context embeddings, co-resident on the GPU.", "MIT"],
  ["Next.js + React", "Portal and marketing site.", "MIT"],
  ["Northflank", "Reference managed-GPU substrate — the first scripted deployment lane; every release is verified here.", "—"],
  ["Azure · AWS · Google Cloud", "Customer-owned tenancies for the same containers — resource group, account, or project per customer.", "—"],
  ["Model Context Protocol", "The MCP standard the service integrations speak.", "MIT"],
];

function PersonIcon({ kind }: { kind: Person["links"][number]["kind"] }) {
  if (kind === "linkedin") return <Linkedin className="w-4 h-4" />;
  if (kind === "github") return <Github className="w-4 h-4" />;
  return <ExternalLink className="w-4 h-4" />;
}

export default function ContributorsPage() {
  return (
    <>
      <div className="bg-[hsl(var(--brand-primary))] text-[hsl(var(--brand-accent-fg))]">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))] mb-3">
            Contributors
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Built by people, on open source.
          </h1>
          <p className="mt-5 text-lg max-w-3xl leading-relaxed text-[hsl(var(--brand-accent-fg))/0.9]">
            FlatClaw is Apache 2.0 and stands on a stack of open-weight models
            and open-source software. The people and projects below made it
            possible.
          </p>
        </div>
      </div>

      <Section eyebrow="People & partners" title="Who's behind it">
        <div className="grid md:grid-cols-3 gap-5">
          {people.map((p) => (
            <div
              key={p.name}
              className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-6 shadow-sm flex flex-col"
            >
              <h3 className="font-semibold text-lg text-[hsl(var(--fc-fg-primary))]">
                {p.name}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))] flex-1">
                {p.role}
              </p>
              <div className="mt-4 flex flex-col gap-1.5">
                {p.links.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-[hsl(var(--brand-primary))] hover:underline"
                  >
                    <PersonIcon kind={l.kind} />
                    {l.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        eyebrow="Acknowledgments"
        title="Built on"
        lede="Every dependency is MIT / Apache / BSD compatible. FlatClaw integrates these projects; it does not claim them."
        variant="soft"
      >
        <div className="grid md:grid-cols-2 gap-4">
          {builtOn.map(([name, what, license]) => (
            <div
              key={name}
              className="bg-[hsl(var(--fc-bg-surface))] rounded-md ring-1 ring-[hsl(var(--fc-bg-tertiary))] px-5 py-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-[hsl(var(--fc-fg-primary))]">
                  {name}
                </span>
                <span className="text-[11px] font-mono text-[hsl(var(--fc-fg-muted))] shrink-0">
                  {license}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">
                {what}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        eyebrow="Contribute"
        title="Want on this list?"
        lede="FlatClaw is open source. Issues, pull requests, skills, and MCP services are all welcome."
      >
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] px-5 py-2.5 font-semibold hover:brightness-110 transition"
        >
          <Github className="w-4 h-4" />
          Contribute on GitHub
        </a>
      </Section>
    </>
  );
}
