import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SPOTLIGHTS, FEATURED_SPOTLIGHT_IDS } from "@/lib/useCases";
import { SpotlightCard } from "@/components/SpotlightCard";

/** Three featured spotlights for the home page, plus the link to the full explorer. */
export function FeaturedSpotlights() {
  const featured = FEATURED_SPOTLIGHT_IDS.map((id) =>
    SPOTLIGHTS.find((s) => s.id === id),
  ).filter((s): s is NonNullable<typeof s> => Boolean(s));

  return (
    <div>
      <div className="grid gap-5 md:grid-cols-3">
        {featured.map((s) => (
          <SpotlightCard key={s.id} s={s} />
        ))}
      </div>
      <div className="mt-8">
        <Link
          href="/use-cases"
          className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--brand-accent-deep))] text-white px-5 py-2.5 font-semibold hover:bg-[hsl(var(--brand-accent))] transition"
        >
          Browse all {SPOTLIGHTS.length} spotlights
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
