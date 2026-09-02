import Link from "next/link";
import Image from "next/image";
import { Server, ArrowRight, Check } from "lucide-react";
import { CLOUD_PARTNERS, LOGO_NOTICE, type CloudPartner } from "@/lib/clouds";

/**
 * Cloud partner tiles. `compact` is the home-page strip (logo, tagline,
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
      <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
        {compact && (
          <Link
            href="/partners"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[hsl(var(--brand-accent-deep))] hover:text-[hsl(var(--brand-accent))] transition shrink-0"
          >
            How each lane works
            <ArrowRight className="w-4 h-4" />
          </Link>
        )}
        <p className="text-[11px] leading-relaxed text-[hsl(var(--fc-fg-muted))]">
          {LOGO_NOTICE}
        </p>
      </div>
    </div>
  );
}

function CloudLogo({ c, compact }: { c: CloudPartner; compact: boolean }) {
  const h = compact ? Math.round((c.logoHeight ?? 32) * 0.8) : (c.logoHeight ?? 32);
  if (!c.logo) {
    return (
      <div className="flex items-center gap-2.5 text-[hsl(var(--fc-fg-primary))]">
        <span className="w-9 h-9 rounded-md bg-[hsl(var(--brand-accent))/0.12] text-[hsl(var(--brand-accent-deep))] flex items-center justify-center">
          <Server className="w-5 h-5" />
        </span>
        <span className="font-semibold text-base leading-tight">{c.name}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5" style={{ height: compact ? 40 : 48 }}>
      <Image
        src={c.logo}
        alt={c.name}
        width={Math.round(h * 4)}
        height={h}
        style={{ height: h, width: "auto", maxWidth: "100%" }}
        unoptimized
      />
      {c.logoIsMark && (
        <span className="font-semibold text-[hsl(var(--fc-fg-primary))] leading-tight">
          {c.name}
        </span>
      )}
    </div>
  );
}

function CloudTile({ c, compact }: { c: CloudPartner; compact: boolean }) {
  return (
    <div
      className={
        "bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 p-5 shadow-sm transition flex flex-col " +
        (c.scripted
          ? "ring-[hsl(var(--brand-accent))] "
          : "ring-[hsl(var(--fc-bg-tertiary))] hover:ring-[hsl(var(--brand-accent))/0.6] ")
      }
    >
      <CloudLogo c={c} compact={compact} />
      <div className="mt-3 text-[10.5px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent-deep))]">
        {c.lane}
      </div>
      <p className="mt-2 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">
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
