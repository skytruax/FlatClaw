import Link from "next/link";
import {
  Calculator,
  Phone,
  FileInput,
  BarChart3,
  ShieldCheck,
  ClipboardCheck,
  Megaphone,
  ArrowRight,
} from "lucide-react";
import { CAPABILITIES } from "@/lib/capabilities";
import { SPOTLIGHTS } from "@/lib/useCases";

const ICONS = {
  estimating: Calculator,
  voice: Phone,
  intake: FileInput,
  reporting: BarChart3,
  knowledge: ShieldCheck,
  operations: ClipboardCheck,
  revenue: Megaphone,
} as const;

/** Six families of work the platform runs, each linked to the spotlights that prove it. */
export function PlatformCapabilities() {
  return (
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      {CAPABILITIES.map((c) => {
        const Icon = ICONS[c.id as keyof typeof ICONS];
        const proofs = c.spotlights
          .map((id) => SPOTLIGHTS.find((s) => s.id === id))
          .filter((s): s is NonNullable<typeof s> => Boolean(s))
          .slice(0, c.featured ? 4 : 2);
        if (c.featured) {
          return (
            <div
              key={c.id}
              className="md:col-span-2 lg:col-span-3 bg-[hsl(var(--brand-primary))] text-white rounded-xl ring-1 ring-[hsl(var(--brand-accent))/0.5] p-6 md:p-8 shadow-md"
            >
              <div className="grid lg:grid-cols-[1.2fr_1fr] gap-8">
                <div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-md bg-[hsl(var(--brand-accent))] text-white flex items-center justify-center">
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="text-[10.5px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))]">
                      Featured family
                    </span>
                  </div>
                  <h3 className="mt-4 text-2xl md:text-3xl font-bold tracking-tight leading-tight">
                    {c.title}
                  </h3>
                  <p className="mt-3 text-base leading-relaxed text-white/85 max-w-2xl">
                    {c.body}
                  </p>
                  {c.stats && (
                    <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
                      {c.stats.map(([v, k]) => (
                        <div key={k}>
                          <dt className="text-xl md:text-2xl font-bold text-[hsl(var(--brand-accent))] tracking-tight">
                            {v}
                          </dt>
                          <dd className="mt-1 text-xs leading-snug text-white/75">{k}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
                <div className="lg:border-l lg:border-white/15 lg:pl-8">
                  <div className="text-[10.5px] font-semibold uppercase tracking-widest text-white/60 mb-3">
                    Spotlights
                  </div>
                  <ul className="space-y-3">
                    {proofs.map((s) => (
                      <li key={s.id}>
                        <Link
                          href={`/use-cases/${s.id}/`}
                          className="group block rounded-lg bg-white/5 ring-1 ring-white/10 p-3.5 hover:bg-white/10 hover:ring-[hsl(var(--brand-accent))] transition"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold text-sm">{s.title}</div>
                              <div className="mt-0.5 text-[13px] text-white/70 leading-snug">{s.useCase}</div>
                            </div>
                            <ArrowRight className="w-4 h-4 mt-0.5 shrink-0 text-[hsl(var(--brand-accent))] group-hover:translate-x-0.5 transition-transform" />
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          );
        }
        return (
          <div
            key={c.id}
            className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-6 shadow-sm flex flex-col hover:ring-[hsl(var(--brand-accent))/0.5] transition"
          >
            <div className="w-10 h-10 rounded-md bg-[hsl(var(--brand-accent))/0.12] text-[hsl(var(--brand-accent-deep))] flex items-center justify-center mb-4">
              <Icon className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-semibold text-[hsl(var(--fc-fg-primary))] leading-snug">
              {c.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              {c.body}
            </p>
            <div className="mt-4 pt-4 border-t border-[hsl(var(--fc-bg-tertiary))]">
              <div className="text-[10.5px] font-semibold uppercase tracking-widest text-[hsl(var(--fc-fg-muted))] mb-2">
                Spotlights
              </div>
              <ul className="space-y-1.5">
                {proofs.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/use-cases/${s.id}/`}
                      className="group inline-flex items-start gap-1.5 text-sm text-[hsl(var(--brand-accent-deep))] hover:text-[hsl(var(--brand-accent))] transition"
                    >
                      <span className="font-medium">{s.title}</span>
                      <ArrowRight className="w-3.5 h-3.5 mt-1 shrink-0 opacity-60 group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}
