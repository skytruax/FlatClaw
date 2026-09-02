import Link from "next/link";
import Image from "next/image";
import { GITHUB_URL, SCHEDULE_DEMO_URL, GHCR_INFERENCE_URL } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="bg-[hsl(var(--brand-primary))] text-[hsl(var(--brand-accent-fg))]">
      <div className="mx-auto max-w-6xl px-5 py-12 md:py-14">
        <div className="grid gap-10 md:grid-cols-[1.7fr_1fr_1fr_1fr]">
          {/* Brand + CTA */}
          <div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <Image
                src="/partners/kirk-tech-solutions-white.svg"
                alt="Kirk Tech Solutions"
                width={120}
                height={24}
                className="h-6 w-auto"
              />
              <span
                aria-hidden="true"
                className="hidden sm:block w-px h-10 bg-[hsl(var(--brand-accent-fg))/0.3]"
              />
              <Image
                src="/branding/wordmark-tagline-white.svg"
                alt="FlatClaw, Private AI Platform"
                width={167}
                height={50}
                className="h-[50px] w-auto"
              />
            </div>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-block text-[11px] uppercase tracking-widest text-[hsl(var(--brand-accent-fg))/0.6] hover:text-[hsl(var(--brand-accent))] transition"
            >
              A Kirk Open Source Community Project
            </a>
            <p className="mt-4 text-sm leading-relaxed text-[hsl(var(--brand-accent-fg))/0.8] max-w-xs">
              The open-source Private AI Platform. Single-tenant,
              auditable, with mechanically verifiable data locality — on
              Azure, AWS, Google Cloud, Northflank, or your own hardware.
            </p>
            <a
              href={SCHEDULE_DEMO_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] px-4 py-2 text-sm font-semibold hover:brightness-110 transition"
            >
              Schedule a demo
            </a>
          </div>

          <FooterCol title="Product">
            <FooterLink href="/#what">What it is</FooterLink>
            <FooterLink href="/use-cases">Use case spotlights</FooterLink>
            <FooterLink href="/#architecture">Architecture</FooterLink>
            <FooterLink href="/#privacy">Data locality</FooterLink>
            <FooterLink href="/tokenomics">Tokenomics</FooterLink>
            <FooterLink href="/#roadmap">Roadmap</FooterLink>
          </FooterCol>

          <FooterCol title="Company">
            <FooterLink href="/about">About</FooterLink>
            <FooterLink href="/partners">Partners</FooterLink>
            <FooterLink href="/contributors">Contributors</FooterLink>
          </FooterCol>

          <FooterCol title="Open source">
            <FooterLink href={GITHUB_URL}>GitHub</FooterLink>
            <FooterLink href={GHCR_INFERENCE_URL}>Inference image</FooterLink>
            <FooterLink href="https://ai.google.dev/gemma/terms">
              Gemma terms
            </FooterLink>
          </FooterCol>
        </div>
      </div>

      <div className="border-t border-[hsl(var(--brand-accent-fg))/0.15]">
        <div className="mx-auto max-w-6xl px-5 py-4 text-xs text-[hsl(var(--brand-accent-fg))/0.7] flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>© {new Date().getFullYear()} FlatClaw · Apache 2.0 — root and all components.</span>
          <span>
            Inference image:{" "}
            <code className="font-mono text-[10px]">
              ghcr.io/skytruax/flatclaw-inference
            </code>
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))] mb-3">
        {title}
      </div>
      <ul className="space-y-2 text-sm text-[hsl(var(--brand-accent-fg))/0.85]">
        {children}
      </ul>
    </div>
  );
}

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const external = href.startsWith("http");
  return (
    <li>
      {external ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="hover:text-[hsl(var(--brand-accent))] transition"
        >
          {children}
        </a>
      ) : (
        <Link
          href={href}
          className="hover:text-[hsl(var(--brand-accent))] transition"
        >
          {children}
        </Link>
      )}
    </li>
  );
}
