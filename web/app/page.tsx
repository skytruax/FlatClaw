import { Hero } from "@/components/Hero";
import { Section } from "@/components/Section";
import { FeatureGrid } from "@/components/FeatureGrid";
import { ArchitectureDiagram } from "@/components/ArchitectureDiagram";
import { Roadmap } from "@/components/Roadmap";

export default function HomePage() {
  return (
    <>
      <Hero />

      <Section
        id="why"
        eyebrow="Why it exists"
        title="Same product shape. None of the data egress."
        lede={
          <>
            Between January and April 2026, every frontier lab converged on the
            same product: an agentic AI coworker with a task inbox, saved
            schedules, document memory, and direct access to local files and
            connected apps. <strong>Claude Cowork</strong> defined the
            category. <strong>Gemini Enterprise Agent</strong> is the
            identical-shaped response. <strong>GPT‑6 + Atlas</strong> is the
            unified version.
          </>
        }
      >
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-[hsl(var(--fc-bg-surface))] rounded-xl p-6 ring-1 ring-[hsl(var(--fc-bg-tertiary))]">
            <h3 className="font-semibold text-lg mb-2">The problem</h3>
            <p className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              Every one of those products is structurally cloud-hosted and
              sends your data to the vendor&apos;s servers on every request.
              For firms whose data contractually or legally cannot leave their
              own infrastructure — legal, healthcare, accounting, finance,
              government, and everyone adjacent — that category is unreachable.
            </p>
          </div>
          <div className="bg-[hsl(var(--brand-primary))/0.07] rounded-xl p-6 ring-1 ring-[hsl(var(--brand-primary))/0.25]">
            <h3 className="font-semibold text-lg mb-2 text-[hsl(var(--brand-primary))]">
              The answer
            </h3>
            <p className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              FlatClaw is the same product shape, built out of open-source
              components, running entirely inside infrastructure the operator
              controls. Apache 2.0. Pulled, audited, deployed. Every line is
              yours.
            </p>
          </div>
        </div>
      </Section>

      <Section
        id="what"
        eyebrow="What's in the box"
        title="A complete coworker stack — not a framework."
        lede="Eight pre-integrated components. Pull, deploy, use. Each one is replaceable and auditable on its own."
        variant="soft"
      >
        <FeatureGrid />
      </Section>

      <Section
        id="architecture"
        eyebrow="Architecture"
        title="Single-tenant. Customer-owned. End-to-end."
        lede={
          <>
            Everything — Portal, OpenClaw Gateway, Inference (H100), RAGFlow,
            and the weights-server — lives in one Northflank project. Customer
            holds the Northflank account directly. Nothing leaves their
            tenancy.
          </>
        }
      >
        <ArchitectureDiagram />
      </Section>

      <Section
        id="cost"
        eyebrow="Token Economics"
        title="≈ $2,000 / month per tenant. Sized for 20–30 SMB seats."
        lede="Indicative monthly cost at Northflank's published list pricing, single tenant, prod held warm 24/7. The H100 dominates; everything else combined is under $200."
      >
        <div className="grid lg:grid-cols-2 gap-8">
          <div className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-6 shadow-sm">
            <h3 className="font-semibold text-base mb-4 text-[hsl(var(--fc-fg-primary))]">
              Monthly cost breakdown
            </h3>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-[hsl(var(--fc-bg-tertiary))]">
                {[
                  ["Inference (H100 80GB, held warm)", "~$1,800"],
                  ["Portal — nf-compute-400", "~$50"],
                  ["OpenClaw Gateway — nf-compute-400", "~$50"],
                  ["RAGFlow + corpus volume", "~$30"],
                  ["weights-server + 200 GB nvme", "~$30"],
                  ["Egress · TLS · observability", "included"],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-2 pr-3 text-[hsl(var(--fc-fg-secondary))]">
                      {k}
                    </td>
                    <td className="py-2 text-right font-mono text-[hsl(var(--fc-fg-primary))]">
                      {v}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[hsl(var(--brand-primary))/0.4]">
                  <td className="pt-3 font-semibold text-[hsl(var(--fc-fg-primary))]">
                    Total per tenant, all-in
                  </td>
                  <td className="pt-3 text-right font-mono font-bold text-[hsl(var(--brand-primary))]">
                    ~$2,000 / mo
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-4 text-xs text-[hsl(var(--fc-fg-muted))] leading-relaxed">
              List prices, round numbers. Committed-use or annual deals on
              Northflank typically reduce the GPU line. No second cloud,
              no BYOC plumbing — one bill, one vendor relationship.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="font-semibold text-base text-[hsl(var(--fc-fg-primary))]">
              Why one H100 supports 20–30 daily active users at an SMB
            </h3>
            {[
              {
                k: "Steady-state concurrency is low.",
                v: "A 25-DAU SMB doesn't have 25 people typing at once. Empirically, peak concurrent active sessions land around 5–8 — people skim a result, edit a doc, take a call, ask a follow-up. The H100 needs to serve that peak, not the whole DAU number.",
              },
              {
                k: "The 31B path handles 8–12 concurrent streams.",
                v: "One H100 SGLang process at Gemma 4 31B FP8 sustains ~8–12 concurrent streaming chats with first-token latency in the 1–2 s range. SGLang's RadixAttention prefix cache earns most of that on conversational reuse.",
              },
              {
                k: "Most user actions don't touch the LLM at all.",
                v: "Memory recall, RAG retrieval, file reads, OAuth tool invocations — all gateway- or skill-side. The LLM is invoked for chat turns and tool-call planning. A typical SMB-coworker session is 3–15 LLM calls, not hundreds.",
              },
              {
                k: "Headroom for occasional bursts.",
                v: "Gemma 4 31B FP8 (~33 GB) + KV cache + bge-m3 fits in 80 GB with ~25 GB free. The v0.3 cascade lands a co-resident Gemma 4 4B FP8 in that headroom for fast-turn / planning traffic — same hardware, ~2× concurrent capacity.",
              },
              {
                k: "Larger tenants step up the GPU plan, not the architecture.",
                v: "Beyond ~30 DAU, the next step is a higher-tier Northflank GPU plan or a second inference service for triage. Same project, same architecture.",
              },
            ].map(({ k, v }) => (
              <div
                key={k}
                className="bg-[hsl(var(--fc-bg-surface))] rounded-lg ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-4"
              >
                <div className="font-semibold text-sm text-[hsl(var(--fc-fg-primary))]">
                  {k}
                </div>
                <p className="mt-1 text-sm text-[hsl(var(--fc-fg-secondary))] leading-relaxed">
                  {v}
                </p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section
        id="privacy"
        eyebrow="Private LLM"
        title="Mechanically provable, not marketed."
        lede="The privacy story is not a marketing claim. It is a test you can run yourself."
        variant="soft"
      >
        <ol className="space-y-3">
          {[
            "Provision a tenant in your own Northflank project.",
            "Exercise the v0.1.0-shipped features end-to-end (chat, memory recall/write, scheduled-task fire, GPU cold-boot). As skills land in v0.2, each is added to this test loop.",
            "Run tcpdump on the tenant's Northflank project egress for the full session.",
            "Confirm zero packets to Anthropic, OpenAI, Google AI, Hugging Face, ElevenLabs, Chroma Cloud, or any third-party inference endpoint. Inference traffic stays inside the project — Portal → Gateway → H100 is all internal Northflank network. The only external egress: services the user explicitly connected via OAuth.",
          ].map((step, i) => (
            <li key={i} className="flex gap-4 items-start">
              <span className="shrink-0 w-7 h-7 rounded-full bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] font-bold text-sm flex items-center justify-center">
                {i + 1}
              </span>
              <span className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))] pt-0.5">
                {step}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm text-[hsl(var(--fc-fg-muted))] italic">
          This check runs mechanically on every release. It is the promise the
          project exists to keep.
        </p>
      </Section>

      <Section
        id="stack"
        eyebrow="Technology"
        title="Best-in-class open-source, end to end."
        lede="Every dependency is MIT / Apache / BSD compatible. Nothing here is a vendor lock-in."
      >
        <div className="grid md:grid-cols-2 gap-4">
          {[
            ["Inference", "Patched SGLang + Gemma 4 31B Dense"],
            ["Silicon", "NVIDIA H100 · 80 GB · sm_90 · native FP8"],
            ["Substrate", "Northflank's managed GPU fleet — one project per tenant"],
            ["Context", "TurboQuant turbo4 KV — 1M tokens on a single card (roadmap)"],
            ["Agent runtime", "OpenClaw — RBAC at every tool call · per-agent memory built in"],
            ["Frontend", "Next.js 16 + React 19 + TypeScript + SQLite"],
            ["Auth", "better-auth (v1) · WorkOS SSO (v2)"],
            ["Retrieval", "RAGFlow — wrapped as an OpenClaw skill"],
            ["Memory", "OpenClaw per-agent — agent-owned markdown under each workspace"],
            ["Embeddings", "bge-m3 · multilingual · long-context · ~2 GB VRAM"],
            ["Voice (v0.3)", "VoxCPM2 — open-weight cloning + TTS"],
            ["Image (v0.3)", "ComfyUI + SDXL"],
          ].map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between gap-4 bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] rounded-md px-4 py-3"
            >
              <span className="font-medium text-[hsl(var(--fc-fg-primary))]">
                {k}
              </span>
              <span className="text-sm text-[hsl(var(--fc-fg-secondary))] text-right">
                {v}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="roadmap"
        eyebrow="Roadmap"
        title="Shipping in the open."
        lede="What's working today vs. what's coming next is honest, enumerated, and verifiable."
        variant="soft"
      >
        <Roadmap />
      </Section>

      <Section
        id="cta"
        eyebrow="Get started"
        title="Pull it. Audit it. Run it."
        lede="Apache 2.0 — explicit patent grant. OSI-approved. Bring your own infra."
        variant="dark"
      >
        <div className="flex flex-wrap gap-3">
          <a
            href="https://github.com/skytruax/FlatClaw"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-md bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] px-5 py-2.5 font-semibold hover:brightness-110 transition"
          >
            github.com/skytruax/FlatClaw
          </a>
          <a
            href="https://github.com/skytruax/FlatClaw/pkgs/container/flatclaw-inference"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-md ring-1 ring-[hsl(var(--brand-accent-fg))/0.3] px-5 py-2.5 font-medium hover:bg-[hsl(var(--brand-accent-fg))/0.08] transition"
          >
            Inspect the inference image
          </a>
        </div>
      </Section>
    </>
  );
}
