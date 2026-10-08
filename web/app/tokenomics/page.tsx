import type { Metadata } from "next";
import Link from "next/link";
import { Section } from "@/components/Section";

export const metadata: Metadata = {
  title: "Tokenomics",
  description:
    "What a token costs on FlatClaw's two model classes, the standard class on one H100-class card and the frontier class on an eight-GPU node, against the hosted API rate card of October 2026.",
};

/* Output-token prices per million, ranked: hosted list prices (October 2026, sources at the foot of the page)
   and FlatClaw's own nodes, all-in, at full utilization. */
type RateRow = { name: string; price: string; note?: string; ours?: boolean; frontier?: boolean };
const rateCard: RateRow[] = [
  { name: "Claude Haiku 5.5", price: "$0.50 – $2.50", note: "tiered by request size" },
  { name: "FlatClaw frontier class, fast node", price: "$0.54", note: "GLM-5.2 on eight B200s, NVFP4 with multi-token prediction", ours: true, frontier: true },
  { name: "FlatClaw standard class", price: "$0.66", note: "Gemma 4 31B at FP8 on one H100", ours: true },
  { name: "FlatClaw frontier class", price: "$1.04", note: "GLM-5.2 on eight H200s, FP8 with multi-token prediction", ours: true, frontier: true },
  { name: "GPT-5.6 Luna", price: "$1.20" },
  { name: "Gemini 3.8 Flash", price: "$3.75" },
  { name: "GLM-5.2, rented from Z.ai", price: "$4.40", note: "the same open weights, hosted", frontier: true },
  { name: "Claude Haiku 4.5", price: "$5" },
  { name: "Claude Sonnet 5.5", price: "$10" },
  { name: "Gemini 3.1 Pro", price: "$12", note: "$18 above 200K-token prompts", frontier: true },
  { name: "GPT-5.6 Terra", price: "$12" },
  { name: "Claude Opus 5.5", price: "$20", frontier: true },
  { name: "GPT-5.6 Sol", price: "$20", note: "promotional, $30 list", frontier: true },
  { name: "GPT-5.5", price: "$30", frontier: true },
  { name: "Claude Fable 5.1", price: "$50", frontier: true },
];

/* Both classes, all-in (node, control plane, weights volume) at October 2026 list prices, at full utilization. */
const classRows: { k: string; standard: string; frontier: string }[] = [
  { k: "Model", standard: "Gemma 4 31B at FP8, 256K context", frontier: "GLM-5.2, 744B mixture of experts, 1M context" },
  { k: "Cloud node", standard: "1 × H100 80 GB", frontier: "8 × H200 at FP8, or 8 × B200 at NVFP4 (fast)" },
  { k: "Flat rate, held warm", standard: "about $2,200 a month", frontier: "about $18,700 (H200) or $34,700 (B200) a month" },
  { k: "Aggregate output, measured", standard: "about 1,260 tokens/s at concurrency 128", frontier: "about 6,800 tokens/s (H200) or 24,000 tokens/s (B200)" },
  { k: "Output tokens per month", standard: "about 3.3 billion", frontier: "about 18 billion (H200) or 64 billion (B200)" },
  { k: "Per 1M output tokens", standard: "about $0.66", frontier: "about $1.04 (H200) or $0.54 (B200)" },
];

/* The same month of output, billed by the token at hosted list rates. */
const sameMonth: { node: string; tokens: string; flat: string; rows: [string, string][] }[] = [
  {
    node: "Standard class, one H100",
    tokens: "3.3 billion output tokens a month",
    flat: "$2,200 flat",
    rows: [
      ["Claude Sonnet 5.5 at $10", "$33,000"],
      ["Claude Opus 5.5 at $20", "$66,000"],
      ["GPT-5.5 at $30", "$99,000"],
    ],
  },
  {
    node: "Frontier class, eight H200s",
    tokens: "18 billion output tokens a month",
    flat: "$18,700 flat",
    rows: [
      ["GLM-5.2 rented at $4.40", "$79,000"],
      ["Claude Opus 5.5 at $20", "$360,000"],
      ["Claude Fable 5.1 at $50", "$900,000"],
    ],
  },
  {
    node: "Frontier class, eight B200s",
    tokens: "64 billion output tokens a month",
    flat: "$34,700 flat",
    rows: [
      ["GLM-5.2 rented at $4.40", "$282,000"],
      ["Claude Opus 5.5 at $20", "$1.28 million"],
      ["Claude Fable 5.1 at $50", "$3.2 million"],
    ],
  },
];

/* Published head-to-head results for GLM-5.2 against the frontier labs (sources at the foot of the page).
   Bars are drawn relative to the best score in each row. */
type Bench = { name: string; unit: string; note?: string; scores: { model: string; value: number; who: "glm" | "openai" | "anthropic" }[] };
const headToHead: Bench[] = [
  { name: "SWE-bench Pro", unit: "% resolved", note: "real-world bug fixes", scores: [{ model: "GLM-5.2", value: 62.1, who: "glm" }, { model: "GPT-5.5", value: 58.6, who: "openai" }] },
  { name: "MCP-Atlas", unit: "% tool-use tasks", note: "agentic tool use", scores: [{ model: "GLM-5.2", value: 77.0, who: "glm" }, { model: "Claude Opus 4.8", value: 77.8, who: "anthropic" }, { model: "GPT-5.5", value: 75.3, who: "openai" }] },
  { name: "Humanity's Last Exam", unit: "% with tools", scores: [{ model: "GLM-5.2", value: 54.7, who: "glm" }, { model: "GPT-5.5", value: 52.2, who: "openai" }] },
  { name: "SWE-bench Verified", unit: "% resolved", scores: [{ model: "GLM-5.2", value: 78.7, who: "glm" }, { model: "GPT-5.5", value: 80.6, who: "openai" }] },
  { name: "GPQA Diamond", unit: "% graduate science", scores: [{ model: "GLM-5.2", value: 91.2, who: "glm" }, { model: "GPT-5.5", value: 94.0, who: "openai" }] },
  { name: "Text Arena, coding", unit: "Elo", note: "human preference", scores: [{ model: "GLM-5.2", value: 1593, who: "glm" }, { model: "Claude Fable 5", value: 1654, who: "anthropic" }] },
  { name: "AIME 2026", unit: "% solved", scores: [{ model: "GLM-5.2", value: 99.2, who: "glm" }] },
];
const whoColor: Record<"glm" | "openai" | "anthropic", string> = {
  glm: "hsl(var(--brand-accent))",
  anthropic: "hsl(var(--brand-primary) / 0.8)",
  openai: "hsl(var(--fc-fg-muted) / 0.6)",
};

const beyondPrice: [string, string][] = [
  [
    "No gate on what you may research or build.",
    "A hosted frontier model decides what it will help with, and the vendor's policy sits between your people and the model. Claude Fable 5.1 ships with additional safety measures on dual-use capabilities, and the ungated variant is sold only to approved organizations. GLM-5.2 is open weights running in your tenancy: security research, red-team tooling, vulnerability analysis, chemistry, legal, whatever your business is, runs under your rule books, your approvals and your audit trail, with no provider-side classifier in the loop and no account to lose.",
  ],
  [
    "Nothing leaves the tenancy.",
    "Weights, prompts, documents and case records stay on the node the customer owns, on the cloud they already run or on their own rack. No retention policy to negotiate, no training clause to read, no sub-processor list to review. The data-locality test is mechanical: tcpdump on the egress shows no inference traffic leaving.",
  ],
  [
    "No rate limits, no quotas, no silent model swaps.",
    "The node is the tenant's. There is no per-minute cap at the moment a workflow fans out, no priority tier to buy, and the model version is pinned until the tenant chooses to move. A hosted model is retired, repriced or re-tuned on the vendor's calendar; this one changes on the customer's.",
  ],
  [
    "A flat line in the budget.",
    "The GPU line is the same in a busy month and a quiet one, so the tenant can let agents run without a meter ticking: overnight batch jobs, long agentic sessions, a storefront chat widget on a sale day. Per-token pricing taxes exactly the usage that creates value.",
  ],
];

const whichClass: [string, string][] = [
  [
    "Standard class",
    "The default tenant. One H100-class card, a flat rate, and the cheapest private token on the market for the work most teams actually do all day.",
  ],
  [
    "Frontier class",
    "For tenants whose hardest work must run on a frontier-grade model inside the tenancy: deep reasoning, long agentic runs, research the hosted models will not touch. Eight GPUs, one flat rate, no meter.",
  ],
  [
    "Both",
    "The standard class as the floor and the frontier node for the flagship work, behind the same endpoint. Same platform, same agents, same front door.",
  ],
];

const sources: { label: string; href: string }[] = [
  { label: "Anthropic API pricing", href: "https://www.anthropic.com/pricing" },
  { label: "OpenAI API pricing", href: "https://openai.com/api/pricing/" },
  { label: "Gemini API pricing", href: "https://ai.google.dev/gemini-api/docs/pricing" },
  { label: "Z.ai GLM-5.2 pricing", href: "https://z.ai/model-api" },
  { label: "Gemma 4 31B hosted providers (Artificial Analysis)", href: "https://artificialanalysis.ai/models/gemma-4-31b/providers" },
  { label: "GLM-5 on B200 and H200 with multi-token prediction (SemiAnalysis InferenceX)", href: "https://inferencex.semianalysis.com/blog/b200-glm5-nvfp4-vs-h200-fp8-3-6x-perf-per-dollar" },
  { label: "GLM-5.2 serving recipe (SGLang docs)", href: "https://lmsysorg.mintlify.app/cookbook/autoregressive/GLM/GLM-5.2" },
  { label: "GLM-5.2 benchmarks: SWE-bench Pro, MCP-Atlas, HLE, GPQA, AIME (apidog)", href: "https://apidog.com/blog/glm-5-2-benchmarks/" },
  { label: "SWE-bench Verified and coding arena leaderboards (LM Council)", href: "https://lmcouncil.ai/benchmarks" },
  { label: "SWE-bench Pro leaderboard (Morph)", href: "https://www.morphllm.com/swe-bench-pro" },
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
            into output at about 66 cents per million tokens. The frontier class runs a frontier-grade open model on
            eight GPUs inside the tenancy at about a dollar per million, a twentieth of frontier-lab list rates. Here
            is the math, refreshed October 2026.
          </p>
        </div>
      </div>

      <Section
        eyebrow="01 · Thesis"
        title="The per-token premium is structural, not promotional."
        lede="At a tenant's volume, hosted API rates run fifteen to seventy times the hardware cost of the same inference on the standard class, and twenty to ninety times on the frontier class. Not because the providers are mispriced. Their rate has to carry spare capacity, an orchestration stack and margin on top of the GPU. Run a node for one tenant and you keep the GPU line and shed the rest."
      >
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-[hsl(var(--fc-bg-surface))] rounded-xl p-6 ring-1 ring-[hsl(var(--fc-bg-tertiary))]">
            <p className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              A token generated on the same silicon costs the same in physics whoever runs it. What differs is what
              has to be packed into the price. The hosted rate card below is the October 2026 list; the self-hosted
              figures are what the nodes on the <Link href="/builds" className="font-semibold text-[hsl(var(--brand-primary))] hover:text-[hsl(var(--brand-accent))]">builds page</Link> cost, held warm and fully used.
            </p>
          </div>
          <div className="bg-[hsl(var(--brand-primary))/0.07] rounded-xl p-6 ring-1 ring-[hsl(var(--brand-primary))/0.25]">
            <p className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              Two classes, because two different things are being bought. The standard class is the cheapest private
              token on the market for the work most teams do all day. The frontier class puts a frontier-grade model
              inside the tenancy, cheaper than renting its own weights and with nobody else's policy in the loop.
            </p>
          </div>
        </div>
      </Section>

      <Section
        eyebrow="02 · The two classes"
        title="What a token costs on each node."
        lede="All-in figures: the GPU node, the control plane and the weights volume, at indicative list prices on our reference lane, the same classes on Azure, AWS and Google Cloud landing in the same band on reserved terms."
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
                <tr key={r.k} className={r.k.startsWith("Per 1M") ? "bg-[hsl(var(--brand-accent))/0.06]" : ""}>
                  <td className="py-2.5 pr-4 text-[hsl(var(--fc-fg-secondary))] align-top w-[28%]">{r.k}</td>
                  <td className={"py-2.5 pr-4 align-top " + (r.k.startsWith("Per 1M") ? "font-bold text-[hsl(var(--brand-primary))]" : "text-[hsl(var(--fc-fg-primary))]")}>{r.standard}</td>
                  <td className={"py-2.5 align-top " + (r.k.startsWith("Per 1M") ? "font-bold text-[hsl(var(--brand-primary))]" : "text-[hsl(var(--fc-fg-primary))]")}>{r.frontier}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-xs text-[hsl(var(--fc-fg-muted))] leading-relaxed">
            Throughput references: Gemma 4 31B at FP8 on one H100 with SGLang, about 1,260 output tokens per second
            aggregate at concurrency 128. GLM-5 with multi-token prediction as measured by SemiAnalysis InferenceX,
            about 850 output tokens per second per H200 at FP8 and about 3,000 per B200 at NVFP4, eight of each per
            node. It is the batched aggregate that pays the bill, which is what naive comparisons miss.
          </p>
        </div>

        <div className="mt-6 grid md:grid-cols-2 gap-6">
          <div className="bg-[hsl(var(--brand-primary))/0.07] rounded-xl p-6 ring-1 ring-[hsl(var(--brand-primary))/0.25]">
            <h3 className="font-semibold text-base mb-2 text-[hsl(var(--brand-primary))]">Standard class, in one line</h3>
            <p className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              About $0.66 per million output tokens. Against Sonnet 5.5 at $10 that is a fifteenth of the price for
              the same tier of work; against Opus 5.5, GPT-5.5 and Fable 5.1 it is 30–76× cheaper. It undercuts
              renting Gemma 4 31B from the cheapest host, and the node is private.
            </p>
          </div>
          <div className="bg-[hsl(var(--brand-primary))/0.07] rounded-xl p-6 ring-1 ring-[hsl(var(--brand-primary))/0.25]">
            <h3 className="font-semibold text-base mb-2 text-[hsl(var(--brand-primary))]">Frontier class, in one line</h3>
            <p className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              About $1.04 per million output tokens on the H200 node, $0.54 on the B200 node. Against Opus 5.5 at
              $20, GPT-5.5 at $30 and Fable 5.1 at $50 that is 19–93× cheaper for a model in the same tier, running
              inside the tenancy, and a quarter to an eighth of what renting the same weights from Z.ai costs. The
              fast node is both the cheaper token and the faster stream.
            </p>
          </div>
        </div>
      </Section>

      <Section
        eyebrow="03 · Beyond price"
        title="What the frontier class buys that a rate card cannot show."
        lede="A frontier-grade model inside the tenancy is a different product from a frontier-grade API, even at the same price per token."
      >
        <div className="grid md:grid-cols-2 gap-4">
          {beyondPrice.map(([k, v]) => (
            <div key={k} className="bg-[hsl(var(--fc-bg-surface))] rounded-lg ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-5">
              <div className="font-semibold text-sm text-[hsl(var(--fc-fg-primary))]">{k}</div>
              <p className="mt-1.5 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">{v}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        eyebrow="04 · Ability and price"
        title="A frontier-tier model, priced like a small one."
        lede="On the left, October 2026 list prices per million output tokens with FlatClaw's nodes in the same list. On the right, where GLM-5.2 actually lands against the frontier labs in published head-to-head results. The frontier class sits next to the small models on price and next to GPT-5.5 and Opus on ability."
        variant="soft"
      >
        <div className="grid lg:grid-cols-2 gap-8 items-start">
          <div className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-6 shadow-sm">
            <h3 className="font-semibold text-base mb-1 text-[hsl(var(--fc-fg-primary))]">Price, per 1M output tokens</h3>
            <p className="mb-4 text-xs text-[hsl(var(--fc-fg-muted))] leading-relaxed">Rows marked frontier tier are models in GLM-5.2's class; the rest are smaller or mid-tier models.</p>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-[hsl(var(--fc-bg-tertiary))]">
                {rateCard.map((r) => (
                  <tr key={r.name} className={r.ours ? "bg-[hsl(var(--brand-accent))/0.08]" : ""}>
                    <td className={"py-2 pr-3 " + (r.ours ? "pl-2 rounded-l-md" : "")}>
                      <span className={r.ours ? "font-semibold text-[hsl(var(--brand-primary))]" : "text-[hsl(var(--fc-fg-secondary))]"}>{r.name}</span>
                      {r.frontier ? <span className={"ml-2 align-middle rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide " + (r.ours ? "bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))]" : "bg-[hsl(var(--fc-bg-tertiary))/0.7] text-[hsl(var(--fc-fg-secondary))]")}>frontier tier</span> : null}
                      {r.note ? <span className="block text-[11px] text-[hsl(var(--fc-fg-muted))]">{r.note}</span> : null}
                    </td>
                    <td className={"py-2 text-right font-mono whitespace-nowrap " + (r.ours ? "pr-2 rounded-r-md font-bold text-[hsl(var(--brand-primary))]" : "text-[hsl(var(--fc-fg-primary))]")}>{r.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-6 shadow-sm">
            <h3 className="font-semibold text-base mb-1 text-[hsl(var(--fc-fg-primary))]">Ability: GLM-5.2 against the frontier labs</h3>
            <p className="mb-4 text-xs text-[hsl(var(--fc-fg-muted))] leading-relaxed">Published head-to-head results. GLM-5.2 leads GPT-5.5 on real-world bug fixing and Humanity's Last Exam, ties Opus-class models on agentic tool use, and sits within a few points everywhere else. This is the model the frontier class runs, at $0.54 to $1.04 per million tokens.</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-4 text-[11px] text-[hsl(var(--fc-fg-secondary))]">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: whoColor.glm }} />GLM-5.2, FlatClaw frontier class</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: whoColor.anthropic }} />Anthropic</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: whoColor.openai }} />OpenAI</span>
            </div>
            <div className="space-y-4">
              {headToHead.map((b) => {
                const max = Math.max(...b.scores.map((x) => x.value));
                return (
                  <div key={b.name}>
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="text-sm font-semibold text-[hsl(var(--fc-fg-primary))]">{b.name}</div>
                      <div className="text-[11px] text-[hsl(var(--fc-fg-muted))]">{b.unit}{b.note ? ` · ${b.note}` : ""}</div>
                    </div>
                    <div className="mt-1.5 space-y-1">
                      {b.scores.map((x) => (
                        <div key={x.model} className="grid grid-cols-[7.5rem_1fr_3.5rem] items-center gap-2">
                          <div className={"text-[11px] truncate " + (x.who === "glm" ? "font-semibold text-[hsl(var(--brand-primary))]" : "text-[hsl(var(--fc-fg-secondary))]")}>{x.model}</div>
                          <div className="h-2.5 rounded-full bg-[hsl(var(--fc-bg-tertiary))/0.5] overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${Math.max(4, (x.value / max) * 100)}%`, background: whoColor[x.who] }} />
                          </div>
                          <div className={"text-right font-mono text-[11px] " + (x.who === "glm" ? "font-bold text-[hsl(var(--brand-primary))]" : "text-[hsl(var(--fc-fg-primary))]")}>{x.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-[11px] text-[hsl(var(--fc-fg-muted))] leading-relaxed">Bars are drawn relative to the best score in each row. Figures as published by the labs and the LM Council and Morph leaderboards; see sources.</p>
          </div>
        </div>

        <div className="mt-8">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--fc-fg-muted))] mb-3">The same month, billed by the token</div>
          <div className="grid md:grid-cols-3 gap-4">
            {sameMonth.map((m) => (
              <div key={m.node} className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-5 shadow-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <div className="font-semibold text-sm text-[hsl(var(--fc-fg-primary))]">{m.node}</div>
                    <div className="text-xs text-[hsl(var(--fc-fg-muted))]">{m.tokens}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-extrabold text-[hsl(var(--brand-primary))] whitespace-nowrap">{m.flat}</div>
                    <div className="text-[10px] uppercase tracking-wide text-[hsl(var(--fc-fg-muted))]">FlatClaw</div>
                  </div>
                </div>
                <table className="mt-3 w-full text-xs">
                  <tbody className="divide-y divide-[hsl(var(--fc-bg-tertiary))]">
                    {m.rows.map(([k, v]) => (
                      <tr key={k}>
                        <td className="py-1.5 pr-3 text-[hsl(var(--fc-fg-secondary))]">{k}</td>
                        <td className="py-1.5 text-right font-mono text-[hsl(var(--fc-fg-primary))] whitespace-nowrap">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section
        eyebrow="05 · Which class"
        title="Pick the node for the work."
        lede="The choice is not model brand or vendor preference. It is whether the hardest work is allowed to leave the building."
      >
        <div className="grid md:grid-cols-3 gap-4">
          {whichClass.map(([k, v]) => (
            <div key={k} className="bg-[hsl(var(--fc-bg-surface))] rounded-lg ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-5">
              <div className="font-mono text-sm font-semibold text-[hsl(var(--brand-primary))]">{k}</div>
              <p className="mt-2 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">{v}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-base italic text-[hsl(var(--fc-fg-secondary))] max-w-3xl leading-relaxed">
          The numbers move as open weights improve, as serving stacks improve, as providers reprice, and as GPU rates
          change. We re-run the math quarterly and ship whichever shape is cheapest per resolved task. Rate card
          refreshed October 8, 2026; hardware prices are live on the{" "}
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
