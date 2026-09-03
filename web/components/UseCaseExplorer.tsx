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
 * the grid of matching tiles. A chip only appears if choosing it would show at
 * least one spotlight given the other active filter, so there are never empty
 * results to click into. Pure client state; nothing to fetch.
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

  // Chips that would yield at least one spotlight given the *other* filter.
  const useCaseOptions = useMemo(
    () =>
      USE_CASE_FILTERS.filter((u) =>
        SPOTLIGHTS.some(
          (s) => s.useCases.includes(u) && (industry === ALL || s.industries.includes(industry)),
        ),
      ),
    [industry],
  );
  const industryOptions = useMemo(
    () =>
      INDUSTRY_FILTERS.filter((i) =>
        SPOTLIGHTS.some(
          (s) => s.industries.includes(i) && (useCase === ALL || s.useCases.includes(useCase)),
        ),
      ),
    [useCase],
  );

  return (
    <div>
      <FilterGroup
        title="Search By Use Case"
        allLabel="See All Cases"
        options={useCaseOptions}
        value={useCase}
        onChange={(v) => setUseCase(v as UseCaseFilter | typeof ALL)}
      />
      <FilterGroup
        title="Search By Industry"
        allLabel="See All Industries"
        options={industryOptions}
        value={industry}
        onChange={(v) => setIndustry(v as IndustryFilter | typeof ALL)}
        className="mt-12"
      />

      <div className="mt-12 flex items-center justify-between gap-4 text-sm text-[hsl(var(--fc-fg-muted))]">
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

      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((s) => (
          <SpotlightCard key={s.id} s={s} />
        ))}
      </div>
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
        className="mt-6 flex flex-wrap justify-center gap-2.5"
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
                "rounded-md px-5 py-2.5 text-sm font-medium transition ring-1 " +
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
