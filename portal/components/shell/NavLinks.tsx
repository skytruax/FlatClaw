"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavLink {
  href: string;
  label: string;
  /** Also active under these path prefixes (e.g. a section's sub-pages). */
  match?: string[];
}

/** Header navigation in the site's style, with the current section marked. */
export function NavLinks({ links }: { links: NavLink[] }) {
  const pathname = usePathname() ?? "";
  // The longest matching prefix wins, so /admin/settings/oauth-apps marks
  // "OAuth apps" and not "Settings".
  const prefixes = links.flatMap((l) => [l.href, ...(l.match ?? [])].map((p) => ({ p, href: l.href })));
  const current = prefixes
    .filter(({ p }) => pathname === p || pathname.startsWith(p + "/"))
    .sort((a, b) => b.p.length - a.p.length)[0]?.href;
  return (
    <nav className="flex items-center gap-1 text-[15px]">
      {links.map((l) => {
        const active = l.href === current;
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={
              "rounded px-3.5 py-2 transition " +
              (active
                ? "bg-[hsl(var(--brand-accent))/0.22] font-semibold text-[hsl(var(--brand-accent-fg))]"
                : "text-[hsl(var(--brand-accent-fg))/0.88] hover:bg-[hsl(var(--brand-accent))/0.18] hover:text-[hsl(var(--brand-accent-fg))]")
            }
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
