import type { Metadata } from "next";
import { Section } from "@/components/Section";

export const metadata: Metadata = {
  title: "Tokenomics",
  description:
    "Frontier Private Infrastructure Tokenomics — why a dedicated H100 running Gemma 4 31B beats per-token API pricing for the majority of a tenant's workload, and where it doesn't.",
};

const apiRates: [string, string][] = [
  ["Claude Haiku 4.5", "$5"],
  ["OpenAI GPT-5.3 Codex", "$14"],
  ["Claude Sonnet 4.6", "$15"],
  ["Claude Opus 4.7", "$25"],
  ["OpenAI GPT-5.5", "$30"],
];

const selfHosted: [string, string][] = [
  ["90% utilization", "~$0.95 / 1M output tokens"],
  ["70% utilization", "~$1.35 / 1M output tokens"],
  ["50% utilization", "~$1.90 / 1M output tokens"],
];

const costStack: [string, string][] = [
  [
    "Provider GPU cost",
    "~$1–2 per 1M output tokens at high utilization. What the provider pays for the same H100 silicon we lease. Roughly equal across all serious providers — the only layer dedicated infrastructure keeps.",
  ],
  [
    "Spare-capacity overhead — 1.5–2×",
    "Multi-tenant serving keeps idle headroom to absorb traffic bursts. A dedicated single-tenant box sizes to actual demand, not statistical worst case.",
  ],
  [
    "Orchestration & observability — 1.5–2×",
    "Global load balancing, multi-region failover, abuse detection, per-key rate limiting, usage metering, billing. SGLang plus a load balancer replaces this layer for a single-tenant workload.",
  ],
  [
    "Margin — 3–5×",
    "API providers are venture-funded businesses with research roadmaps and growth targets. Reasonable for the company — not the customer's problem to pay for at the customer's volume.",
  ],
];

const tradeoffs: [string, string][] = [
  [
    "At our configuration, Gemma 4 31B is comparable to Claude Sonnet 4.6.",
    "Arena Elo 1452 (#3 among open models), Codeforces 2150, 89.2% on AIME 2026, 85.2% on MMLU Pro. Run at our configuration — 256K context, FP8 on a dedicated H100, with complexity-based routing — Gemma 4 31B is comparable to Claude Sonnet 4.6 across the workloads tenants actually run, at roughly 1/11th the per-token cost. The frontier tier — Opus 4.7 and GPT-5.5 — still leads on the hardest reasoning, long-horizon agentic work, and the upper end of coding. The case is not “Gemma replaces every model,” it's “Gemma matches the Sonnet tier for the majority of the workload, and you route the hardest fraction up.”",
  ],
  [
    "Routing by complexity is the decision that saves money.",
    "The agent runtime classifies each request. Self-hosted Gemma handles classification, summarization, simple code edits, RAG synthesis over the tenant's own data, agent sub-tasks, and structured extraction — the 70–80% where a strong open model is sufficient. Frontier APIs handle complex reasoning, novel agentic tasks, and anything explicitly escalated. “Kill all API usage” is the wrong framing and usually loses on quality.",
  ],
  [
    "Utilization is the silent killer.",
    "At 30% utilization the cost per token doubles. At 15% it quadruples. The case only holds if a tenant has enough sustained demand to keep the GPU hot. Below threshold, API is correct — and we say so.",
  ],
  [
    "Engineering overhead is real.",
    "Running SGLang at scale with monitoring, autoscaling, failover, eval pipelines, model updates, and on-call coverage is roughly 0.5–1 FTE per fleet. We amortize that across deployments so the per-token numbers are real, not aspirational. At one tenant this looks barely better than API; at ten-plus it looks great.",
  ],
];

const thresholds: [string, string][] = [
  [
    "Below ~100M output tokens/month",
    "Per-token API is almost always correct. You will not amortize the engineering overhead of a dedicated cluster.",
  ],
  [
    "100M – 1B output tokens/month",
    "The calculation gets interesting. Routing some traffic to a dedicated box and keeping the long tail on API is often the right answer.",
  ],
  [
    "Above ~1B output tokens/month",
    "You almost certainly should at least evaluate self-hosting — and for the majority of the workload the answer is probably yes.",
  ],
];

export default function TokenomicsPage() {
  return (
    <>
      <div className="bg-[hsl(var(--brand-primary))] text-[hsl(var(--brand-accent-fg))]">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))] mb-3">
            Tokenomics
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight max-w-4xl">
            Frontier Private Infrastructure Tokenomics
          </h1>
          <p className="mt-5 text-lg max-w-3xl leading-relaxed text-[hsl(var(--brand-accent-fg))/0.9]">
            When per-token economics flip on dedicated GPUs — and when they
            don&apos;t. A workload that runs ~$30,000/month at Claude Sonnet 4.6
            list rates runs ~$2,000/month, flat, on the H100 we lease for a
            tenant. Here is the math behind that, and the honest places where it
            fails.
          </p>
        </div>
      </div>

      <Section
        eyebrow="01 · Thesis"
        title="The per-token premium is structural, not promotional."
        lede="At a tenant's steady-state volume, paying per-token API rates costs roughly 11× the underlying hardware cost of the same inference versus the comparable Sonnet 4.6 tier — and up to ~18–22× against the frontier models."
      >
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-[hsl(var(--fc-bg-surface))] rounded-xl p-6 ring-1 ring-[hsl(var(--fc-bg-tertiary))]">
            <p className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              Not because Anthropic and OpenAI are mispriced — they are priced
              correctly for their target customer. Their per-token rate has to
              carry GPU cost, multi-tenant spare-capacity overhead, an
              orchestration and reliability stack, and margin. Run dedicated
              GPUs for a single tenant and you keep the first layer and shed the
              rest.
            </p>
          </div>
          <div className="bg-[hsl(var(--brand-primary))/0.07] rounded-xl p-6 ring-1 ring-[hsl(var(--brand-primary))/0.25]">
            <p className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              The collapse is structural, not a temporary pricing inefficiency.
              A token generated on the same H100 silicon costs the same in
              physics whether OpenAI runs it or we do. What differs is what has
              to be packed into the price tag.
            </p>
          </div>
        </div>
      </Section>

      <Section
        eyebrow="02 · The numbers"
        title="API rate card vs dedicated H100."
        lede="List output-token pricing across the major hosted APIs (May 2026), against Gemma 4 31B-IT on a single H100 with SGLang (FP8, RadixAttention, 256K context) at a $2.50/hr long-term lease."
        variant="soft"
      >
        <div className="grid lg:grid-cols-2 gap-8">
          <div className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-6 shadow-sm">
            <h3 className="font-semibold text-base mb-4 text-[hsl(var(--fc-fg-primary))]">
              Hosted API — per 1M output tokens
            </h3>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-[hsl(var(--fc-bg-tertiary))]">
                {apiRates.map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-2 pr-3 text-[hsl(var(--fc-fg-secondary))]">
                      {k}
                    </td>
                    <td className="py-2 text-right font-mono text-[hsl(var(--fc-fg-primary))]">
                      {v}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-4 text-xs text-[hsl(var(--fc-fg-muted))] leading-relaxed">
              Input tokens are 4–6× cheaper across the board, but output
              dominates real bills because output is what gets generated for the
              user.
            </p>
          </div>

          <div className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-6 shadow-sm">
            <h3 className="font-semibold text-base mb-4 text-[hsl(var(--fc-fg-primary))]">
              Self-hosted Gemma 4 31B — by utilization
            </h3>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-[hsl(var(--fc-bg-tertiary))]">
                {selfHosted.map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-2 pr-3 text-[hsl(var(--fc-fg-secondary))]">
                      {k}
                    </td>
                    <td className="py-2 text-right font-mono text-[hsl(var(--fc-fg-primary))]">
                      {v}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-4 text-xs text-[hsl(var(--fc-fg-muted))] leading-relaxed">
              ~1,260 output tokens/sec aggregate at concurrency ~128.
              Single-stream is ~40 tok/s — it is the batched aggregate that pays
              the bill, which is what most naive comparisons miss.
            </p>
          </div>
        </div>

        <div className="mt-6 grid md:grid-cols-2 gap-6">
          <div className="bg-[hsl(var(--brand-primary))/0.07] rounded-xl p-6 ring-1 ring-[hsl(var(--brand-primary))/0.25]">
            <h3 className="font-semibold text-base mb-2 text-[hsl(var(--brand-primary))]">
              The gap
            </h3>
            <p className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              At our configuration Gemma 4 31B is comparable to Sonnet 4.6 — at
              $1.35 against $15.00 per 1M output tokens, that&apos;s the same
              tier of output for about 1/11th the cost. Against Opus 4.7 or
              GPT-5.5: 18–22× cheaper, with the frontier tier reserved for the
              hardest fraction.
            </p>
          </div>
          <div className="bg-[hsl(var(--brand-primary))/0.07] rounded-xl p-6 ring-1 ring-[hsl(var(--brand-primary))/0.25]">
            <h3 className="font-semibold text-base mb-2 text-[hsl(var(--brand-primary))]">
              Breakeven
            </h3>
            <p className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              A single H100 at ~$1,800–2,000/month at 60% utilization produces
              ~2B output tokens/month. The same volume at Sonnet list runs
              ~$30,000/month. Breakeven against Sonnet lands near 130M output
              tokens/month — ~4M tokens/day.
            </p>
          </div>
        </div>
      </Section>

      <Section
        eyebrow="03 · The cost stack"
        title="Four layers, four multipliers."
        lede="The API price tag has to cover four layers. Walk through each and the 10–25× delta stops looking like magic."
      >
        <div className="grid md:grid-cols-2 gap-4">
          {costStack.map(([k, v]) => (
            <div
              key={k}
              className="bg-[hsl(var(--fc-bg-surface))] rounded-lg ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-5"
            >
              <div className="font-semibold text-sm text-[hsl(var(--fc-fg-primary))]">
                {k}
              </div>
              <p className="mt-1.5 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">
                {v}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-[hsl(var(--fc-fg-muted))] leading-relaxed max-w-3xl">
          Compound the multipliers and the 10–25× delta falls out. At low
          volume, paying the multiplier is correct — the engineering overhead of
          a dedicated cluster never amortizes. At the volume this page is about,
          the multiplier has become a tax.
        </p>
      </Section>

      <Section
        eyebrow="04 · Trade-offs"
        title="Where the case for self-hosting is wrong."
        lede="Skip this section and it reads like marketing. Include it and it reads like engineering. There are four places where the case fails."
        variant="soft"
      >
        <div className="space-y-3">
          {tradeoffs.map(([k, v]) => (
            <div
              key={k}
              className="bg-[hsl(var(--fc-bg-surface))] rounded-lg ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-5"
            >
              <div className="font-semibold text-sm text-[hsl(var(--fc-fg-primary))]">
                {k}
              </div>
              <p className="mt-1.5 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">
                {v}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        eyebrow="05 · What this means"
        title="Thresholds for other teams."
        lede="The threshold isn't model brand or vendor preference. It's monthly output volume and steady-state utilization."
      >
        <div className="grid md:grid-cols-3 gap-4">
          {thresholds.map(([k, v]) => (
            <div
              key={k}
              className="bg-[hsl(var(--fc-bg-surface))] rounded-lg ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-5"
            >
              <div className="font-mono text-sm font-semibold text-[hsl(var(--brand-primary))]">
                {k}
              </div>
              <p className="mt-2 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">
                {v}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-base italic text-[hsl(var(--fc-fg-secondary))] max-w-3xl leading-relaxed">
          We&apos;ll be wrong about parts of this. The numbers will move as open
          weights catch up, as serving stacks improve, as API providers
          reprice, and as GPU lease rates change. We re-run the math quarterly
          and ship whichever shape is cheapest per resolved task. The math is
          what it is.
        </p>
      </Section>

    </>
  );
}
