/**
 * The attribution under every page, in the words and style of the site's
 * footer. Replaces the orange Kirk ribbon the portal used to carry under its
 * header: FlatClaw's own accent is signal blue.
 */
export function AppFooter() {
  return (
    <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-6 text-[11px] uppercase tracking-widest text-[hsl(var(--fc-fg-muted))]">
      <a
        href="https://github.com/skytruax/FlatClaw"
        target="_blank"
        rel="noopener noreferrer"
        className="transition hover:text-[hsl(var(--brand-accent-deep))]"
      >
        A Kirk Open Source Community Project
      </a>
      <span>
        FlatClaw · Private AI Platform by{" "}
        <a
          href="https://kirktechsolutions.com"
          target="_blank"
          rel="noopener noreferrer"
          className="transition hover:text-[hsl(var(--brand-accent-deep))]"
        >
          Kirk Tech Solutions
        </a>
      </span>
    </footer>
  );
}
