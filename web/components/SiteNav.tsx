import Link from "next/link";
import Image from "next/image";

const links = [
  { href: "/#what", label: "What it is" },
  { href: "/#architecture", label: "Architecture" },
  { href: "/#privacy", label: "Private LLM" },
  { href: "/#cost", label: "Token Economics" },
  { href: "/#roadmap", label: "Roadmap" },
  { href: "/partners", label: "Partners" },
  { href: "/about", label: "About" },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 bg-[hsl(var(--brand-primary))] text-[hsl(var(--brand-accent-fg))] shadow-md">
      <div className="mx-auto max-w-6xl px-5 py-3 flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <Image
            src="/branding/wordmark-white.svg"
            alt="FlatClaw"
            width={140}
            height={28}
            priority
            style={{ height: "auto" }}
          />
        </Link>
        <nav className="flex items-center gap-1 ml-auto text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="px-3 py-1.5 rounded hover:bg-[hsl(var(--brand-accent))/0.18] transition"
            >
              {l.label}
            </Link>
          ))}
          <a
            href="https://github.com/skytruax/FlatClaw"
            target="_blank"
            rel="noreferrer"
            className="ml-2 px-3 py-1.5 rounded bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] font-medium hover:brightness-110 transition"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
