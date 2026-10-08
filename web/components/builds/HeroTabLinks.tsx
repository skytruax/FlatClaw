"use client";

import { switchTab, useBuildsTab, type TabKey } from "./tabState";

const LINKS: { key: TabKey; label: string }[] = [
  { key: "references", label: "Local and cloud references" },
  { key: "recipes", label: "Build recipes" },
];

/** The two buttons in the hero: they switch the tab below, scroll to it, and show which one is open. */
export function HeroTabLinks() {
  const tab = useBuildsTab();
  return (
    <div className="mt-6 flex flex-wrap gap-3 text-sm">
      {LINKS.map((l) => {
        const active = tab === l.key;
        return (
          <a
            key={l.key}
            href={`#${l.key}`}
            aria-current={active ? "true" : undefined}
            onClick={(e) => {
              e.preventDefault();
              switchTab(l.key, true);
            }}
            className={
              "rounded-md px-4 py-2 font-semibold transition " +
              (active
                ? "bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] hover:opacity-90"
                : "ring-1 ring-white/30 text-[hsl(var(--brand-accent-fg))] hover:bg-white/10")
            }
          >
            {l.label}
          </a>
        );
      })}
    </div>
  );
}
