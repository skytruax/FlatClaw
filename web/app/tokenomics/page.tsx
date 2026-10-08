import type { Metadata } from "next";
import Link from "next/link";
import { Section } from "@/components/Section";

export const metadata: Metadata = {
  title: "Tokenomics",
  description:
    "What a token costs on FlatClaw's two model classes, the standard class on one H100-class card and the frontier class on an eight-GPU node, against the hosted API rate card of October 2026, and where self-hosting is the wrong call.",
};

/* Hosted output-token list prices, October 2026. Sources at the foot of the page. */
const apiRates: [string, string, string][] = [
  ["Claude Haiku 5.5", "$0.50 – $2.50", "tiered by request size"],
  ["GPT-5.6 Luna", "$1.20", ""],
  ["Gemini 3.8 Flash", "$3.75", ""],
  ["GLM-5.2, rented from Z.ai", "$4.40", "the frontier-class weights, hosted"],
  ["Claude Haiku 4.5", "$5", ""],
  ["Claude Sonnet 5.5", "$10", ""],
  ["Gemini 3.1 Pro", "$12", "$18 above 200K-token prompts"],
  ["GPT-5.6 Terra", "$12", ""],
  ["Claude Opus 5.5", "$20", ""],
  ["GPT-5.6 Sol", "$20", "promotional, $30 list"],
  ["GPT-5.5", "$30", ""],
  ["Claude Fable 5.1", "$50", ""],
];

/* Both classes at 70 % utilization, all-in (node, control plane, weights volume), October 2026 list prices. */
const classRows: { k: string; standard: string; frontier: string }[] = [
  { k: "Model", standard: "Gemma 4 31B at FP8, 256K context", frontier: "GLM-5.2 at FP8, 744B mixture of experts, 1M context" },
  { k: "Cloud node", standard: "1 × H100 80 GB", frontier: "8 × H200 (economy) or 8 × B200 (fast)" },
  { k: "Flat rate, held warm", standard: "about $2,200 a month", frontier: "about $18,700 (H200) or $34,700 (B200) a month" },
  { k: "Local box, every part on Newegg", standard: "about $20,000 once", frontier: "about $182,000 once" },
  { k: "Local box per month, 36 months plus power", standard: "about $640", frontier: "about $5,400" },
  { k: "Aggregate output, reference", standard: "about 1,260 tokens/s at concurrency 128", frontier: "1,200–1,400 tokens/s with speculative decoding; more on long prompts" },
  { k: "Per 1M output tokens, cloud, 70 % busy", standard: "about $0.95", frontier: "about $8 (H200) or $14 (B200)" },
  { k: "Per 1M output tokens, local box, 70 % busy", standard: "about $0.27", frontier: "about $6" },
];

const costStack: [string, string][] = [
  [
    "GPU cost",
    "What the provider pays for the same silicon we lease or buy. Roughly equal across serious providers; the one layer dedicated infrastructure keeps.",
  ],
  [
    "Spare capacity, 1.5–2×",
    "Multi-tenant serving holds idle headroom for traffic bursts. A single-tenant node is sized to one tenant's demand, not to a statistical worst case.",
  ],
  [
    "Orchestration and observability, 1.5–2×",
    "Global load balancing, multi-region failover, abuse detection, per-key rate limiting, metering, billing. For one tenant, a serving engine behind one endpoint replaces the layer.",
  ],
  [
    "Margin, 3–5×",
    "Hosted providers carry research roadmaps and growth targets in the price. Reasonable for them; not a cost the tenant has to pay at the tenant's volume.",
  ],
];

const tradeoffs: [string, string][] = [
  [
    "The frontier class is not the cheapest token.",
    "Renting GLM-5.2 from Z.ai costs $4.40 per million output tokens. Serving the same weights on an eight-H200 node held warm at 70 % costs about $8, on eight B200s about $14, and on the eight-card server you own about $6. The frontier class is bought because the weights, the prompts and the records stay inside the tenancy, and because the node answers to one customer. It beats frontier-lab list rates by 2–6×; it does not beat renting the open weights from a hosted API, and this page does not pretend otherwise.",
  ],
  [
    "Utilization is the silent killer.",
    "Every figure above assumes the node is 70 % busy. At 30 % the cost per token more than doubles; at 15 % it quadruples. The case holds only for a tenant with enough sustained work to keep the GPU hot. Below that, a hosted API is correct, and we say so.",
  ],
  [
    "Capacity is concurrency, not head count.",
    "What a node serves is peak concurrent sessions. One H100 sustains 8–12 concurrent streaming chats at FP8 with first tokens in one to two seconds; a tenant of thirty people rarely has more than a dozen talking to the model at once. The flat rate does not move when the tenant adds people; it moves when sustained concurrency outgrows the node.",
  ],
  [
    "Route by difficulty.",
    "The standard class handles classification, summarization, extraction, code edits, retrieval over the tenant's own data and agent sub-tasks: most of a tenant's day. The frontier class, or a hosted frontier model for the tenants that allow it, takes the hardest reasoning and the longest agentic runs. Sending everything to the biggest model is the expensive mistake in both directions.",
  ],
  [
    "Engineering overhead is real.",
    "Serving at scale with monitoring, failover, eval pipelines, model updates and on-call is roughly half to one full-time engineer per fleet. We amortize it across tenants, which is why the per-token figures are real rather than aspirational. At one tenant the standard class looks only somewhat better than an API; at ten it looks very good.",
  ],
];

const thresholds: [string, string][] = [
  [
    "Below about 100M output tokens a month",
    "A hosted API is almost always correct. The engineering overhead of a dedicated node never amortizes, whatever the class.",
  ],
  [
    "100M to 1B output tokens a month",
    "The standard class pays for itself: one node held warm covers the volume at about a dollar per million tokens, with the long tail routed up.",
  ],
  [
    "Frontier work that cannot leave the building",
    "The frontier class is the answer when the hardest fraction of the work must run on a frontier-grade model inside the tenancy. Buy it for locality and control, and keep the standard class as the floor.",
  ],
];

const sources: { label: string; href: string }[] = [
  { label: "Anthropic API pricing", href: "https://www.anthropic.com/pricing" },
  { label: "OpenAI API pricing", href: "https://openai.com/api/pricing/" },
  { label: "Gemini API pricing", href: "https://ai.google.dev/gemini-api/docs/pricing" },
  { label: "Z.ai GLM-5.2 pricing", href: "https://z.ai/model-api" },
  { label: "Gemma 4 31B hosted providers (Artificial Analysis)", href: "https://artificialanalysis.ai/models/gemma-4-31b/providers" },
  { label: "GLM-5 FP8 on 8 × B200 vs 8 × H200 (SGLang + EAGLE)", href: "https://gist.github.com/BenHamm/dcd09f595fef141567a39582f502cef4" },
  { label: "B200 vs H200 on GLM-5, performance per dollar (SemiAnalysis InferenceX)", href: "https://inferencex.semianalysis.com/blog/b200-glm5-nvfp4-vs-h200-fp8-3-6x-perf-per-dollar" },
  { label: "GLM-5.2 serving recipe (SGLang docs)", href: "https://lmsysorg.mintlify.app/cookbook/autoregressive/GLM/GLM-5.2" },
  { label: "US commercial electricity price (EIA)", href: "https://www.eia.gov/electricity/monthly/" },
];

function Th({ children }: { children: React.ReactNode }) {
  return <th className="py-2.5 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--fc-fg-muted))]">{children}</th>;
}

export default function TokenomicsPage() {
  return (
    <>
      <div className="bg-[hsl(var(--brand-primary))] text-[hsl(var(--brand-accent-fg))]">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))] mb-3">
            Tokenomics
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight max-w-4xl">
            Two model classes, one flat rate each.
          </h1>
          <p className="mt-5 text-lg max-w-3xl leading-relaxed text-[hsl(var(--brand-accent-fg))/0.9]">
            A FlatClaw tenant pays for a node held warm, not for tokens. The standard class turns one H100-class card
            into about a dollar per million output tokens. The frontier class runs a frontier-grade open model on
            eight GPUs inside the tenancy for a fraction of frontier-lab list rates. Here is the math, refreshed
            October 2026, and the places where it fails.
          </p>
        </div>
      </div>

      <Section
        eyebrow="01 · Thesis"
        title="The per-token premium is structural, not promotional."
        lede="At a tenant's steady-state volume, hosted API rates run ten to fifty times the hardware cost of the same inference on the standard class, and two to six times on the frontier class. Not because the providers are mispriced. Their rate has to carry spare capacity, an orchestration stack and margin on top of the GPU. Run a node for one tenant and you keep the GPU line and shed the rest."
      >
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-[hsl(var(--fc-bg-surface))] rounded-xl p-6 ring-1 ring-[hsl(var(--fc-bg-tertiary))]">
            <p className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              A token generated on the same silicon costs the same in physics whoever runs it. What differs is what
              has to be packed into the price. The hosted rate card below is the October 2026 list; the self-hosted
              figures are what the nodes on the <Link href="/builds" className="font-semibold text-[hsl(var(--brand-primary))] hover:text-[hsl(var(--brand-accent))]">builds page</Link> cost, held warm, at a realistic 70 % utilization.
            </p>
          </div>
          <div className="bg-[hsl(var(--brand-primary))/0.07] rounded-xl p-6 ring-1 ring-[hsl(var(--brand-primary))/0.25]">
            <p className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              Two classes, because two different things are being bought. The standard class is bought for cheap,
              private tokens at volume. The frontier class is bought so that frontier-grade work never leaves the
              tenancy; it is cheaper than frontier-lab APIs, and it is honest about not being the cheapest token on
              the market.
            </p>
          </div>
        </div>
      </Section>

      <Section
        eyebrow="02 · The two classes"
        title="What a token costs on each node."
        lede="All-in figures: the GPU node, the control plane and the weights volume, at indicative list prices on our reference lane, the same classes on Azure, AWS and Google Cloud landing in the same band on reserved terms. Local boxes are the Newegg builds, amortized over 36 months plus power at the US commercial average of about 14 cents per kWh."
        variant="soft"
      >
        <div className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-5 md:p-6 shadow-sm overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr>
                <Th>{""}</Th>
                <Th>Standard class</Th>
                <Th>Frontier class</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--fc-bg-tertiary))]">
              {classRows.map((r) => (
                <tr key={r.k}>
                  <td className="py-2.5 pr-4 text-[hsl(var(--fc-fg-secondary))] align-top w-[28%]">{r.k}</td>
                  <td className="py-2.5 pr-4 text-[hsl(var(--fc-fg-primary))] align-top">{r.standard}</td>
                  <td className="py-2.5 text-[hsl(var(--fc-fg-primary))] align-top">{r.frontier}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-xs text-[hsl(var(--fc-fg-muted))] leading-relaxed">
            Throughput references: Gemma 4 31B at FP8 on one H100 with SGLang, about 1,260 output tokens per second
            aggregate at concurrency 128 (single-stream is about 40). GLM-5 at FP8 on eight H200s or eight B200s with
            SGLang and EAGLE speculative decoding, 1,215 and 1,370 output tokens per second; the GLM-5.2 serving recipe
            adds 34–78 % on long prompts. The eight-card local server runs the same checkpoint on GDDR7 at roughly
            40 % of the node's aggregate throughput (1.8 TB/s per card against 4.8 TB/s on HBM3e). It is the batched aggregate that pays the bill, which is what naive
            comparisons miss.
          </p>
        </div>

        <div className="mt-6 grid md:grid-cols-2 gap-6">
          <div className="bg-[hsl(var(--brand-primary))/0.07] rounded-xl p-6 ring-1 ring-[hsl(var(--brand-primary))/0.25]">
            <h3 className="font-semibold text-base mb-2 text-[hsl(var(--brand-primary))]">Standard class, in one line</h3>
            <p className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              About $0.95 per million output tokens held warm in the cloud, about $0.27 on the box you own. Against
              Sonnet 5.5 at $10 that is a tenth of the price for the same tier of work; against Opus 5.5, GPT-5.5 and
              Fable 5.1 it is 20–50× cheaper, with those models kept for the hardest fraction. Even renting Gemma 4 31B
              from the cheapest host costs $0.34 per million, and the node is private.
            </p>
          </div>
          <div className="bg-[hsl(var(--brand-primary))/0.07] rounded-xl p-6 ring-1 ring-[hsl(var(--brand-primary))/0.25]">
            <h3 className="font-semibold text-base mb-2 text-[hsl(var(--brand-primary))]">Frontier class, in one line</h3>
            <p className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              About $8 per million output tokens on the economy node, $14 on the fast node, about $6 on the eight-card
              server you own. Against Opus 5.5 at $20, GPT-5.5 at $30 and Fable 5.1 at $50 that is 2–6× cheaper for a
              model in the same tier, running inside the tenancy. Renting the same weights from Z.ai is $4.40, so the
              frontier class is a locality and control decision, not a price play.
            </p>
          </div>
        </div>
      </Section>

      <Section
        eyebrow="03 · The rate card"
        title="Hosted output-token prices, October 2026."
        lede="List prices per million output tokens from the official rate cards, surveyed October 2026. Input tokens are four to six times cheaper across the board; output dominates real bills because output is what gets generated for the user."
      >
        <div className="grid lg:grid-cols-[1.2fr_1fr] gap-8 items-start">
          <div className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-6 shadow-sm">
            <h3 className="font-semibold text-base mb-4 text-[hsl(var(--fc-fg-primary))]">Hosted API, per 1M output tokens</h3>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-[hsl(var(--fc-bg-tertiary))]">
                {apiRates.map(([k, v, note]) => (
                  <tr key={k}>
                    <td className="py-2 pr-3 text-[hsl(var(--fc-fg-secondary))]">
                      {k}
                      {note ? <span className="block text-[11px] text-[hsl(var(--fc-fg-muted))]">{note}</span> : null}
                    </td>
                    <td className="py-2 text-right font-mono text-[hsl(var(--fc-fg-primary))] whitespace-nowrap">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-4">
            <div className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-6 shadow-sm">
              <h3 className="font-semibold text-base mb-3 text-[hsl(var(--fc-fg-primary))]">Standard class, by utilization</h3>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-[hsl(var(--fc-bg-tertiary))]">
                  {[["90 % busy", "$0.73"], ["70 % busy", "$0.95"], ["50 % busy", "$1.33"], ["30 % busy", "$2.21"]].map(([k, v]) => (
                    <tr key={k}>
                      <td className="py-2 pr-3 text-[hsl(var(--fc-fg-secondary))]">{k}</td>
                      <td className="py-2 text-right font-mono text-[hsl(var(--fc-fg-primary))]">{v} / 1M output tokens</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-[hsl(var(--fc-fg-muted))] leading-relaxed">One H100 node, all-in about $2,200 a month, about 1,260 output tokens per second aggregate.</p>
            </div>
            <div className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-6 shadow-sm">
              <h3 className="font-semibold text-base mb-3 text-[hsl(var(--fc-fg-primary))]">Frontier class, by utilization</h3>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-[hsl(var(--fc-bg-tertiary))]">
                  {[["90 % busy", "$6.50", "$10.70"], ["70 % busy", "$8.40", "$13.80"], ["50 % busy", "$11.70", "$19.30"], ["30 % busy", "$19.50", "$32.10"]].map(([k, h, b]) => (
                    <tr key={k}>
                      <td className="py-2 pr-3 text-[hsl(var(--fc-fg-secondary))]">{k}</td>
                      <td className="py-2 text-right font-mono text-[hsl(var(--fc-fg-primary))] whitespace-nowrap">{h} H200 · {b} B200</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-[hsl(var(--fc-fg-muted))] leading-relaxed">Eight-GPU node, all-in about $18,700 (H200) or $34,700 (B200) a month, 1,215 and 1,370 output tokens per second with speculative decoding. The fast node costs more per token and answers each stream about twice as fast.</p>
            </div>
          </div>
        </div>
      </Section>

      <Section
        eyebrow="04 · The cost stack"
        title="Four layers, four multipliers."
        lede="A hosted price tag has to cover four layers. Walk through each and the gap stops looking like magic."
        variant="soft"
      >
        <div className="grid md:grid-cols-2 gap-4">
          {costStack.map(([k, v]) => (
            <div key={k} className="bg-[hsl(var(--fc-bg-surface))] rounded-lg ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-5">
              <div className="font-semibold text-sm text-[hsl(var(--fc-fg-primary))]">{k}</div>
              <p className="mt-1.5 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">{v}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-[hsl(var(--fc-fg-muted))] leading-relaxed max-w-3xl">
          Compound the multipliers and the gap falls out. At low volume, paying the multiplier is correct: the
          engineering overhead of a dedicated node never amortizes. At the volume this page is about, the multiplier
          has become a tax.
        </p>
      </Section>

      <Section
        eyebrow="05 · Trade-offs"
        title="Where the case for self-hosting is wrong."
        lede="Skip this section and the page reads like marketing. There are five places where the case fails or changes shape."
      >
        <div className="space-y-3">
          {tradeoffs.map(([k, v]) => (
            <div key={k} className="bg-[hsl(var(--fc-bg-surface))] rounded-lg ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-5">
              <div className="font-semibold text-sm text-[hsl(var(--fc-fg-primary))]">{k}</div>
              <p className="mt-1.5 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">{v}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        eyebrow="06 · What this means"
        title="Thresholds for other teams."
        lede="The threshold is not model brand or vendor preference. It is monthly output volume, steady-state utilization, and whether the hardest work is allowed to leave the building."
        variant="soft"
      >
        <div className="grid md:grid-cols-3 gap-4">
          {thresholds.map(([k, v]) => (
            <div key={k} className="bg-[hsl(var(--fc-bg-surface))] rounded-lg ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-5">
              <div className="font-mono text-sm font-semibold text-[hsl(var(--brand-primary))]">{k}</div>
              <p className="mt-2 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">{v}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-base italic text-[hsl(var(--fc-fg-secondary))] max-w-3xl leading-relaxed">
          We will be wrong about parts of this. The numbers move as open weights improve, as serving stacks improve,
          as providers reprice, and as GPU rates change. We re-run the math quarterly and ship whichever shape is
          cheapest per resolved task. Rate card refreshed October 8, 2026; hardware prices are live on the{" "}
          <Link href="/builds" className="font-semibold not-italic text-[hsl(var(--brand-primary))] hover:text-[hsl(var(--brand-accent))]">builds page</Link>.
        </p>
        <div className="mt-8">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--fc-fg-muted))]">Sources</div>
          <ul className="mt-2 grid sm:grid-cols-2 gap-x-8 gap-y-1 text-xs text-[hsl(var(--fc-fg-secondary))]">
            {sources.map((s) => (
              <li key={s.href}>
                <a href={s.href} target="_blank" rel="noreferrer" className="hover:text-[hsl(var(--brand-primary))] underline decoration-[hsl(var(--fc-bg-tertiary))] underline-offset-2">{s.label}</a>
              </li>
            ))}
          </ul>
        </div>
      </Section>
    </>
  );
}
