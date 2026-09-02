import Link from "next/link";
import {
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
          .slice(0, 2);
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
