"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { GITHUB_URL, SCHEDULE_DEMO_URL } from "@/lib/site";

const links = [
  { href: "/#what", label: "What It Is" },
  { href: "/use-cases", label: "Use Cases" },
  { href: "/services", label: "Services" },
  { href: "/#architecture", label: "Architecture" },
  { href: "/tokenomics", label: "Tokenomics" },
  { href: "/builds", label: "Build Recipes" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);

  // Lock body scroll while the mobile drawer is open. Avoids the awkward
  // double-scroll when someone scrolls the menu but expects the page behind
  // to stay put.
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  return (
    <header className="sticky top-0 z-50 bg-[hsl(var(--brand-primary))] text-[hsl(var(--brand-accent-fg))] shadow-md">
      <div className="mx-auto max-w-6xl px-5 h-[72px] flex items-center gap-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 shrink-0"
          onClick={() => setOpen(false)}
        >
          <Image
            src="/branding/wordmark-tagline-white.svg"
            alt="FlatClaw, Private AI Platform"
            width={187}
            height={56}
            priority
            className="h-12 w-auto"
          />
        </Link>

        {/* Desktop nav — shown xl+; below that the drawer, because eight items wrap at 1024–1279 */}
        <nav className="hidden xl:flex items-center gap-0.5 ml-auto text-[15px] whitespace-nowrap">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="px-3 py-2 rounded hover:bg-[hsl(var(--brand-accent))/0.18] transition"
            >
              {l.label}
            </Link>
          ))}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="ml-3 px-3 py-1.5 rounded ring-1 ring-[hsl(var(--brand-accent-fg))/0.3] font-medium hover:bg-[hsl(var(--brand-accent-fg))/0.08] transition"
          >
            GitHub
          </a>
          <a
            href={SCHEDULE_DEMO_URL}
            target="_blank"
            rel="noreferrer"
            className="ml-2 px-3.5 py-1.5 rounded bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] font-medium hover:brightness-110 transition"
          >
            Schedule Demo
          </a>
        </nav>

        {/* Hamburger — shown below xl */}
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((o) => !o)}
          className="xl:hidden ml-auto inline-flex items-center justify-center rounded p-2 hover:bg-[hsl(var(--brand-accent))/0.18] transition"
        >
          {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile drawer — full-width sheet under the bar, slides in.
          Tap a link or the backdrop to dismiss. */}
      {open && (
        <>
          <div
            aria-hidden="true"
            className="xl:hidden fixed inset-0 top-[72px] bg-[hsl(var(--brand-primary))/0.55] backdrop-blur-sm z-40"
            onClick={() => setOpen(false)}
          />
          <nav
            id="mobile-nav"
            className="xl:hidden fixed inset-x-0 top-[72px] z-50 bg-[hsl(var(--brand-primary))] shadow-lg border-t border-[hsl(var(--brand-accent))/0.15]"
          >
            <div className="mx-auto max-w-6xl px-5 py-3 flex flex-col gap-1 text-base">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="px-3 py-3 rounded hover:bg-[hsl(var(--brand-accent))/0.18] transition"
                >
                  {l.label}
                </Link>
              ))}
              <a
                href={SCHEDULE_DEMO_URL}
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpen(false)}
                className="mt-2 px-3 py-3 rounded bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] font-medium text-center"
              >
                Schedule Demo
              </a>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpen(false)}
                className="px-3 py-3 rounded ring-1 ring-[hsl(var(--brand-accent-fg))/0.3] font-medium text-center"
              >
                GitHub
              </a>
            </div>
          </nav>
        </>
      )}
    </header>
  );
}
