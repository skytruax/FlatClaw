"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Spotlight } from "@/lib/useCases";

/**
 * One use-case spotlight tile. Dark navy/blue ground keyed by `hue`, the
 * "Use Case:" and "Results:" lines up front, and an expandable detail.
 */
export function SpotlightCard({ s }: { s: Spotlight }) {
  const [open, setOpen] = useState(false);
  const ground = `linear-gradient(160deg, hsl(${s.hue} 40% 20%) 0%, hsl(${s.hue + 10} 55% 30%) 70%, hsl(${s.hue + 18} 70% 38%) 100%)`;
  const glow = `radial-gradient(ellipse at 85% 15%, hsl(204 100% 50% / 0.35), transparent 55%)`;

  return (
    <article
      className="relative rounded-2xl overflow-hidden text-white shadow-md ring-1 ring-white/10 flex flex-col"
      style={{ background: `${glow}, ${ground}` }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none opacity-[0.12]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.9) 1px, transparent 0)",
          backgroundSize: "18px 18px",
        }}
      />
      <div className="relative p-6 flex flex-col flex-1">
        <h3 className="text-xl md:text-2xl font-semibold leading-snug tracking-tight">
          {s.title}
        </h3>

        <dl className="mt-5 space-y-4 text-[15px] leading-relaxed">
          <div>
            <dt className="font-semibold text-white">Use Case:</dt>
            <dd className="text-white/90">{s.useCase}</dd>
          </div>
          <div>
            <dt className="font-semibold text-white">Results:</dt>
            <dd className="text-white/90">{s.results}</dd>
          </div>
        </dl>

        {open && (
          <p className="mt-4 text-sm leading-relaxed text-white/85 border-t border-white/15 pt-4">
            {s.detail}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-1.5">
          {[...s.useCases, ...s.industries].map((t) => (
            <span
              key={t}
              className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/12 ring-1 ring-white/20"
            >
              {t}
            </span>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-auto pt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[hsl(var(--brand-accent))] hover:text-white transition self-start"
        >
          {open ? "Less" : "How it works"}
          <ChevronDown
            className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>
    </article>
  );
}
