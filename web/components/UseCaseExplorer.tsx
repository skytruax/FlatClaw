"use client";

import { useMemo, useState } from "react";
import {
  SPOTLIGHTS,
  USE_CASE_FILTERS,
  INDUSTRY_FILTERS,
  type UseCaseFilter,
  type IndustryFilter,
} from "@/lib/useCases";
import { SpotlightCard } from "@/components/SpotlightCard";

const ALL = "All";

/**
 * The spotlight selector: two rows of pill filters (use case, industry) and
 * the grid of matching tiles. Pure client state; nothing to fetch, so it
 * works as-is on the static export.
 */
export function UseCaseExplorer() {
  const [useCase, setUseCase] = useState<UseCaseFilter | typeof ALL>(ALL);
  const [industry, setIndustry] = useState<IndustryFilter | typeof ALL>(ALL);

  const visible = useMemo(
    () =>
      SPOTLIGHTS.filter(
        (s) =>
          (useCase === ALL || s.useCases.includes(useCase)) &&
          (industry === ALL || s.industries.includes(industry)),
      ),
    [useCase, industry],
  );

  return (
    <div>
      <FilterGroup
        title="Search by use case"
        allLabel="See all cases"
        options={USE_CASE_FILTERS}
        value={useCase}
        onChange={(v) => setUseCase(v as UseCaseFilter | typeof ALL)}
      />
      <FilterGroup
        title="Search by industry"
        allLabel="See all industries"
        options={INDUSTRY_FILTERS}
        value={industry}
        onChange={(v) => setIndustry(v as IndustryFilter | typeof ALL)}
        className="mt-10"
      />

      <div className="mt-10 flex items-center justify-between gap-4 text-sm text-[hsl(var(--fc-fg-muted))]">
        <span>
          Showing <strong className="text-[hsl(var(--fc-fg-primary))]">{visible.length}</strong> of{" "}
          {SPOTLIGHTS.length} spotlights
        </span>
        {(useCase !== ALL || industry !== ALL) && (
          <button
            type="button"
            onClick={() => {
              setUseCase(ALL);
              setIndustry(ALL);
            }}
            className="text-[hsl(var(--brand-accent-deep))] font-medium hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="mt-6 rounded-xl bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-8 text-center text-sm text-[hsl(var(--fc-fg-secondary))]">
          No spotlight matches that combination yet. Clear a filter, or{" "}
          <a href="mailto:hi@flatclaw.org" className="text-[hsl(var(--brand-accent-deep))] font-medium hover:underline">
            tell us about yours
          </a>
          .
        </div>
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((s) => (
            <SpotlightCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterGroup({
  title,
  allLabel,
  options,
  value,
  onChange,
  className = "",
}: {
  title: string;
  allLabel: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const chips = [ALL, ...options];
  return (
    <div className={className}>
      <h3 className="text-center text-2xl md:text-3xl font-semibold tracking-tight text-[hsl(var(--fc-fg-primary))]">
        {title}
      </h3>
      <div
        role="group"
        aria-label={title}
        className="mt-5 flex flex-wrap justify-center gap-2.5"
      >
        {chips.map((c) => {
          const selected = c === value;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(c)}
              className={
                "rounded-full px-4 py-2 text-sm font-medium transition ring-1 " +
                (selected
                  ? "bg-[hsl(var(--brand-primary))] text-white ring-[hsl(var(--brand-primary))] shadow-sm"
                  : "bg-[hsl(var(--fc-bg-surface))] text-[hsl(var(--brand-accent-deep))] ring-[hsl(var(--fc-bg-tertiary))] hover:ring-[hsl(var(--brand-accent))] hover:text-[hsl(var(--brand-primary))]")
              }
            >
              {c === ALL ? allLabel : c}
            </button>
          );
        })}
      </div>
    </div>
  );
}
