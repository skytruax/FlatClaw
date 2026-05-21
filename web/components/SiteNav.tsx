"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { GITHUB_URL, SCHEDULE_DEMO_URL } from "@/lib/site";

const links = [
  { href: "/#what", label: "What it is" },
  { href: "/#architecture", label: "Architecture" },
  { href: "/tokenomics", label: "Tokenomics" },
  { href: "/#roadmap", label: "Roadmap" },
  { href: "/partners", label: "Partners" },
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
      <div className="mx-auto max-w-6xl px-5 py-3 flex items-center gap-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 shrink-0"
          onClick={() => setOpen(false)}
        >
          <Image
            src="/branding/wordmark-white.svg"
            alt="FlatClaw"
            width={140}
            height={28}
            priority
            style={{ height: "auto" }}
          />
        </Link>

        {/* Desktop nav — hidden on mobile, shown lg+ */}
        <nav className="hidden lg:flex items-center gap-1 ml-auto text-sm">
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
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="ml-2 px-3 py-1.5 rounded ring-1 ring-[hsl(var(--brand-accent-fg))/0.3] font-medium hover:bg-[hsl(var(--brand-accent-fg))/0.08] transition"
          >
            GitHub
          </a>
          <a
            href={SCHEDULE_DEMO_URL}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] font-medium hover:brightness-110 transition"
          >
            Schedule Demo
          </a>
        </nav>

        {/* Mobile hamburger — shown below lg */}
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((o) => !o)}
          className="lg:hidden ml-auto inline-flex items-center justify-center rounded p-2 hover:bg-[hsl(var(--brand-accent))/0.18] transition"
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
            className="lg:hidden fixed inset-0 top-[60px] bg-[hsl(var(--brand-primary))/0.55] backdrop-blur-sm z-40"
            onClick={() => setOpen(false)}
          />
          <nav
            id="mobile-nav"
            className="lg:hidden fixed inset-x-0 top-[60px] z-50 bg-[hsl(var(--brand-primary))] shadow-lg border-t border-[hsl(var(--brand-accent))/0.15]"
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
