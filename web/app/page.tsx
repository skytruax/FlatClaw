import { Hero } from "@/components/Hero";
import { Section } from "@/components/Section";
import { FeatureGrid } from "@/components/FeatureGrid";
import { ArchitectureDiagram } from "@/components/ArchitectureDiagram";
import { Roadmap } from "@/components/Roadmap";
import { CloudGrid } from "@/components/CloudGrid";
import { FeaturedSpotlights } from "@/components/FeaturedSpotlights";
import { PlatformCapabilities } from "@/components/PlatformCapabilities";
import { GITHUB_URL, GHCR_INFERENCE_URL, SCHEDULE_DEMO_URL } from "@/lib/site";

export default function HomePage() {
  return (
    <>
      <Hero />

      <Section
        id="platform"
        eyebrow="One platform, every kind of work"
        title="Built for the work your data can't leave the building for."
        lede="Voice on your phone lines, documents in your drop folders, reporting over your ERPs, search inside your files, actions in your systems. FlatClaw is one platform for all of it, and every family below is backed by a real engagement: a deployment, a demo or a signed proposal, anonymized."
      >
        <PlatformCapabilities />
      </Section>

      <Section
        id="why"
        eyebrow="Why it exists"
        title="A platform you deploy, not a service you rent."
        lede={
          <>
            The frontier labs have shown what AI can do inside an organization:
            agents with a task inbox, scheduled work, document memory, direct
            access to files and connected apps. <strong>Claude Cowork</strong>,{" "}
            <strong>Gemini Enterprise Agent</strong> and{" "}
            <strong>GPT‑6 + Atlas</strong> all deliver it the same way: as a
            service, on their servers, with your data sent over on every
            request.
          </>
        }
        variant="soft"
      >
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-[hsl(var(--fc-bg-surface))] rounded-xl p-6 ring-1 ring-[hsl(var(--fc-bg-tertiary))]">
            <h3 className="font-semibold text-lg mb-2">The problem</h3>
            <p className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              For a large part of the economy that is a non-starter. Law firms,
              healthcare, banks, collections, manufacturers with confidential
              financials, anyone with a contract that says the data stays put:
              the most capable AI on the market is the AI they are not allowed
              to use. The usual fallback is a narrow point solution per
              problem, each with its own vendor and its own copy of the data.
            </p>
          </div>
          <div className="bg-[hsl(var(--brand-accent))/0.08] rounded-xl p-6 ring-1 ring-[hsl(var(--brand-accent))/0.35]">
            <h3 className="font-semibold text-lg mb-2 text-[hsl(var(--brand-accent-deep))]">
              The answer
            </h3>
            <p className="text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
              FlatClaw is the whole platform, deployed into a tenancy you own:
              inference on your own GPU, agents, voice, retrieval, connectors,
              approvals, scheduling and memory, with role-based access at every
              tool call and an audit trail under all of it. Build every use
              case on the same foundation instead of buying a vendor per
              problem. Open source, Apache 2.0, every line yours to read.
            </p>
          </div>
        </div>
      </Section>

      <Section
        id="clouds"
        eyebrow="Cloud partners"
        title="Runs on the cloud you already trust."
        lede="FlatClaw is a set of containers and one GPU node. It deploys into a tenancy the customer owns on any of these, with the same image, the same control plane, and the same privacy proof."
      >
        <CloudGrid compact />
      </Section>

      <Section
        id="what"
        eyebrow="What's in the box"
        title="Everything a Private AI Platform needs, pre-integrated."
        lede="Eight components, one image, one tenancy. Every use case above runs on the same eight. Each one is replaceable and auditable on its own."
      >
        <FeatureGrid />
      </Section>

      <Section
        id="use-cases"
        eyebrow="Use case spotlights"
        title="Real deployments, anonymized."
        lede="How organizations run the platform inside their own tenancies, from the proposals and demos behind it. Filter the full set by use case and industry."
        variant="soft"
      >
        <FeaturedSpotlights />
      </Section>

      <Section
        id="architecture"
        eyebrow="Architecture"
        title="Single-tenant. Customer-owned. End-to-end."
        lede={
          <>
            Everything — Portal, the agent harness, Inference (GPU), and the
            weights-server — lives in one tenancy on the cloud the customer
            already runs: an Azure resource group, an AWS account, a Google
            Cloud project, a Northflank project, or a rack in their building.
            The customer holds the account. Nothing leaves it.
          </>
        }
      >
        <ArchitectureDiagram />
      </Section>

      <Section
        id="cost"
        eyebrow="Token Economics"
        title="≈ $2,000 / month per tenant. Every use case, one flat rate."
        lede="One GPU carries a tenant's whole workload: voice, intake, reporting, search and agents share it. Indicative monthly cost for a single tenant held warm 24/7 on a managed H100 plan, at the reference lane's published list pricing. Azure and AWS H100 classes land in the same band on reserved terms; bare metal amortizes lower. The H100 dominates; everything else combined is under $200. The rate is per tenant and scales with the tenant — not metered per token or per seat."
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
                  ["Portal — small compute (4 vCPU / 8 GB)", "~$50"],
                  ["Agent harness — small compute", "~$50"],
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
                <tr className="border-t-2 border-[hsl(var(--brand-accent))/0.5]">
                  <td className="pt-3 font-semibold text-[hsl(var(--fc-fg-primary))]">
                    Total per tenant, all-in
                  </td>
                  <td className="pt-3 text-right font-mono font-bold text-[hsl(var(--brand-accent-deep))]">
                    ~$2,000 / mo
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-4 text-xs text-[hsl(var(--fc-fg-muted))] leading-relaxed">
              List prices, round numbers. Committed-use or annual terms on any
              of the clouds typically reduce the GPU line. One bill, from the
              cloud the customer already has a relationship with.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="font-semibold text-base text-[hsl(var(--fc-fg-primary))]">
              How one H100 carries a tenant — and how it scales
            </h3>
            {[
              {
                k: "Concurrency, not headcount, sets the load.",
                v: "What the GPU serves is peak concurrent active sessions, not the tenant's total user count — people skim a result, edit a doc, take a call, ask a follow-up. The H100 is sized to that concurrent peak; the per-tenant rate doesn't move with seat count.",
              },
              {
                k: "The 31B path handles 8–12 concurrent streams.",
                v: "One H100 SGLang process at Gemma 4 31B FP8 sustains ~8–12 concurrent streaming chats with first-token latency in the 1–2 s range. SGLang's RadixAttention prefix cache earns most of that on conversational reuse.",
              },
              {
                k: "Most user actions don't touch the LLM at all.",
                v: "Memory recall, RAG retrieval, file reads, OAuth tool invocations — all gateway- or skill-side. The LLM is invoked for chat turns and tool-call planning. A typical session is a handful of LLM calls, not hundreds.",
              },
              {
                k: "Headroom for bursts, then a cascade.",
                v: "Gemma 4 31B FP8 (~33 GB) + KV cache + bge-m3 fits in 80 GB with ~25 GB free. The v0.4 cascade lands a co-resident smaller Gemma in that headroom for fast-turn / planning traffic — same hardware, ~2× concurrent capacity.",
              },
              {
                k: "Tenants scale the GPU plan, not the architecture.",
                v: "When a tenant outgrows one card, the next step is a higher-tier GPU plan or a multi-GPU node on the same cloud — or a second inference service for triage. Same tenancy, same architecture, same per-tenant model.",
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
        lede="The privacy story is not a marketing claim. It is a test you can run yourself, on whichever cloud you deploy to."
        variant="soft"
      >
        <ol className="space-y-3">
          {[
            "Provision a tenant in your own cloud tenancy — Azure, AWS, Google Cloud, Northflank, or your own hardware.",
            "Exercise the shipped features end-to-end (chat, memory, MCP services with approval-gated actions, scheduled-task fire, GPU cold-boot). As features land, each is added to this test loop.",
            "Run tcpdump on the tenancy's egress for the full session.",
            "Confirm zero packets to Anthropic, OpenAI, Google AI, Hugging Face, ElevenLabs, Chroma Cloud, or any third-party inference endpoint. Inference traffic stays inside the tenancy — Portal → Gateway → GPU is all internal network. The only external egress: services the user explicitly connected via OAuth.",
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
        lede="Every dependency is MIT / Apache / BSD compatible. Nothing here is a vendor lock-in — including the cloud."
      >
        <div className="grid md:grid-cols-2 gap-4">
          {[
            ["Inference", "Patched SGLang + Gemma 4 31B Dense"],
            ["Silicon", "NVIDIA H100-class · 80 GB · native FP8"],
            ["Substrate", "Your cloud — Azure, AWS, Google Cloud, Northflank, or bare metal — one tenancy per customer"],
            ["Context", "TurboQuant turbo4 KV — 1M tokens on a single card (roadmap)"],
            ["Agent harness", "Built on the minimal open Pi agent core — RBAC at every tool call · per-agent memory built in · gateway layer swappable behind the session API"],
            ["Frontend", "Next.js 16 + React 19 + TypeScript + SQLite"],
            ["Auth", "better-auth (v1) · WorkOS SSO (v2)"],
            ["Memory", "Harness-native per-agent SQLite — keyword search, seeded per agent"],
            ["Retrieval", "RAGFlow — cited document answers (v0.4)"],
            ["Embeddings (v0.4)", "bge-m3 — semantic memory + RAG, on its own GPU card"],
            ["Voice (v0.4)", "VoxCPM2 — open-weight cloning + TTS"],
            ["Image (v0.4)", "ComfyUI + SDXL"],
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
        lede="Apache 2.0 with an explicit patent grant. Bring your own cloud, or your own hardware. Or bring a workload and see the platform run it."
        variant="dark"
      >
        <div className="flex flex-wrap gap-3">
          <a
            href={SCHEDULE_DEMO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-md bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] px-5 py-2.5 font-semibold hover:brightness-110 transition"
          >
            Schedule a demo
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-md ring-1 ring-[hsl(var(--brand-accent-fg))/0.3] px-5 py-2.5 font-medium hover:bg-[hsl(var(--brand-accent-fg))/0.08] transition"
          >
            github.com/skytruax/FlatClaw
          </a>
          <a
            href={GHCR_INFERENCE_URL}
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
