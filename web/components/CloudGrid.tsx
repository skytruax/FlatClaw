import Link from "next/link";
import { Cloud, Server, Sparkles, ArrowRight, Check } from "lucide-react";
import { CLOUD_PARTNERS, type CloudPartner } from "@/lib/clouds";

/**
 * Cloud partner tiles. `compact` is the home-page strip (name, tagline,
 * status); the full variant on /partners adds the blurb and fit chips.
 */
export function CloudGrid({ compact = false }: { compact?: boolean }) {
  return (
    <div>
      <div
        className={
          compact
            ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
            : "grid gap-5 md:grid-cols-2 xl:grid-cols-3"
        }
      >
        {CLOUD_PARTNERS.map((c) => (
          <CloudTile key={c.id} c={c} compact={compact} />
        ))}
      </div>
      {compact && (
        <div className="mt-6">
          <Link
            href="/partners"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[hsl(var(--brand-accent-deep))] hover:text-[hsl(var(--brand-accent))] transition"
          >
            How each lane works
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      )}
    </div>
  );
}

function CloudTile({ c, compact }: { c: CloudPartner; compact: boolean }) {
  const Icon = c.id === "onprem" ? Server : c.scripted ? Sparkles : Cloud;
  return (
    <div
      className={
        "bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 p-5 shadow-sm transition flex flex-col " +
        (c.scripted
          ? "ring-[hsl(var(--brand-accent))] "
          : "ring-[hsl(var(--fc-bg-tertiary))] hover:ring-[hsl(var(--brand-accent))/0.6] ")
      }
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-md bg-[hsl(var(--brand-accent))/0.12] text-[hsl(var(--brand-accent-deep))] flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-[hsl(var(--fc-fg-primary))] leading-tight">
            {c.name}
          </div>
          <div className="text-[10.5px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent-deep))] mt-0.5">
            {c.lane}
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">
        {c.tagline}
      </p>
      {!compact && (
        <>
          <p className="mt-3 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">
            {c.blurb}
          </p>
          <ul className="mt-4 space-y-1.5">
            {c.fit.map((f) => (
              <li
                key={f}
                className="flex items-center gap-2 text-[13px] text-[hsl(var(--fc-fg-primary))]"
              >
                <Check className="w-3.5 h-3.5 text-[hsl(var(--brand-accent))] shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
