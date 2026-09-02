import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

/**
 * Home-page deep dive on estimating: the data-center takeoff and the
 * manufacturer's pricing/forecast lakehouse, side by side, with the numbers.
 */
const CASES = [
  {
    id: "drawing-takeoff",
    kicker: "Hyperscale data-center bids",
    title: "Takeoff counted from the drawings themselves.",
    intro:
      "A national pre-construction group quotes hundreds of bids a month with a ten-person estimating team, and one hyperscale estimate can take a single estimator two months. What is on the printed page is what the subcontractor is on the hook for.",
    points: [
      "Four issue-for-construction drawing sets, 190 sheets and three manual volumes read natively: 1,045 units across 36 equipment families, every count citing its sheets.",
      "Reconciled with the estimators' own proposal on the lines that drive price: 88 chillers, 216 computer-room air handlers, 36 pumps.",
      "A 161-versus-280 fan-wall-unit spread between drawings and proposal surfaced for adjudication instead of averaged away. That gap is the miss a sub otherwise eats.",
      "Estimators steer in plain language (increase all labor by five percent, union state, twenty percent spares); guardrails cap what moves without a manager; the estimate waits for approval.",
      "Rough-order-of-magnitude output in the team's own schedule-of-pricing format, then proposals in the house format.",
    ],
  },
  {
    id: "erp-consolidation",
    kicker: "Industrial manufacturer, five brands",
    title: "Pricing, margin and forecast across four ERPs.",
    intro:
      "Five brands built by acquisition, four ERPs from four eras, one CRM, and a month-end that lived in spreadsheets. The controller wanted a ledger tape back to the transaction before trusting a consolidated number.",
    points: [
      "A governed lakehouse in the company's own Azure tenant on Microsoft Fabric, fed from every ERP and the CRM, with lineage to the source transaction.",
      "Forecast and pipeline by business unit with accuracy tracked over time, large-job margin watch, and an AR and collections cockpit on the same store.",
      "Ask about any strategic account and get revenue, margin, pipeline and whitespace across brands, with the CRM written back.",
      "Pricing intelligence and aftermarket analytics next, on the same foundation, because the estimate and the actual finally live in one place.",
      "The next acquisition onboards as a templated pattern priced in weeks, not a project each time.",
    ],
  },
] as const;

const MORE = [
  { id: "estimation-benchmarks", label: "Flooring and concrete contractor", sub: "Twelve years of costing sheets turned into live benchmarks, QA before approval, driven from the CRM." },
  { id: "logistics-tower", label: "European logistics group", sub: "A quote control tower over forwarding systems, fuel, routing and risk, for three internal consumers." },
];

export function EstimatingDeepDive() {
  return (
    <div>
      <div className="grid lg:grid-cols-2 gap-6">
        {CASES.map((c) => (
          <div
            key={c.id}
            className="bg-[hsl(var(--fc-bg-surface))] rounded-2xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-6 md:p-8 shadow-sm flex flex-col"
          >
            <div className="text-[10.5px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent-deep))]">
              {c.kicker}
            </div>
            <h3 className="mt-2 text-xl md:text-2xl font-bold tracking-tight text-[hsl(var(--fc-fg-primary))]">
              {c.title}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              {c.intro}
            </p>
            <ul className="mt-5 space-y-2.5">
              {c.points.map((p) => (
                <li key={p} className="flex gap-2.5 text-sm leading-relaxed text-[hsl(var(--fc-fg-primary))]">
                  <Check className="w-4 h-4 mt-1 shrink-0 text-[hsl(var(--brand-accent))]" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <Link
              href={`/use-cases/${c.id}/`}
              className="mt-auto pt-6 inline-flex items-center gap-2 text-sm font-semibold text-[hsl(var(--brand-accent-deep))] hover:text-[hsl(var(--brand-accent))] transition"
            >
              Read the spotlight
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ))}
      </div>
      <div className="mt-6 grid sm:grid-cols-2 gap-4">
        {MORE.map((m) => (
          <Link
            key={m.id}
            href={`/use-cases/${m.id}/`}
            className="group flex items-start justify-between gap-4 rounded-xl bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-5 hover:ring-[hsl(var(--brand-accent))/0.6] transition"
          >
            <div>
              <div className="font-semibold text-[hsl(var(--fc-fg-primary))]">{m.label}</div>
              <div className="mt-1 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">{m.sub}</div>
            </div>
            <ArrowRight className="w-4 h-4 mt-1 shrink-0 text-[hsl(var(--brand-accent-deep))] group-hover:translate-x-0.5 transition-transform" />
          </Link>
        ))}
      </div>
    </div>
  );
}
