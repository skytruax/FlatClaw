import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="bg-[hsl(var(--fc-bg-secondary))] border-t border-[hsl(var(--fc-bg-tertiary))]">
      <div className="mx-auto max-w-6xl px-5 py-8 grid gap-6 md:grid-cols-4 text-sm text-[hsl(var(--fc-fg-secondary))]">
        <div>
          <div className="font-semibold text-[hsl(var(--fc-fg-primary))] mb-2">
            FlatClaw
          </div>
          <p className="text-xs text-[hsl(var(--fc-fg-muted))] leading-relaxed">
            The open-source private-cloud AI coworker. Single-tenant, auditable,
            mechanically verifiable data locality.
          </p>
        </div>
        <FooterCol title="Product">
          <FooterLink href="/#what">What it is</FooterLink>
          <FooterLink href="/#architecture">Architecture</FooterLink>
          <FooterLink href="/#privacy">Private LLM</FooterLink>
          <FooterLink href="/#cost">Token Economics</FooterLink>
          <FooterLink href="/#roadmap">Roadmap</FooterLink>
        </FooterCol>
        <FooterCol title="Company">
          <FooterLink href="/about">About</FooterLink>
          <FooterLink href="/partners">Partners</FooterLink>
          <FooterLink href="https://github.com/skytruax/FlatClaw">
            GitHub
          </FooterLink>
        </FooterCol>
        <FooterCol title="License">
          <p className="text-xs leading-relaxed">
            Apache 2.0 — root and all components.
            <br />
            Inference image:{" "}
            <code className="font-mono text-[10px] text-[hsl(var(--fc-fg-muted))]">
              ghcr.io/skytruax/flatclaw-inference
            </code>
          </p>
        </FooterCol>
      </div>
      <div className="border-t border-[hsl(var(--fc-bg-tertiary))]">
        <div className="mx-auto max-w-6xl px-5 py-3 text-xs text-[hsl(var(--fc-fg-muted))] flex items-center justify-between">
          <span>© {new Date().getFullYear()} FlatClaw. Built in the open.</span>
          <span>flatclaw.org</span>
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
      <div className="font-semibold text-[hsl(var(--fc-fg-primary))] mb-2">
        {title}
      </div>
      <ul className="space-y-1 text-xs">{children}</ul>
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
          className="hover:text-[hsl(var(--brand-primary))] hover:underline"
        >
          {children}
        </a>
      ) : (
        <Link
          href={href}
          className="hover:text-[hsl(var(--brand-primary))] hover:underline"
        >
          {children}
        </Link>
      )}
    </li>
  );
}
