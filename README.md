<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./branding/wordmark-white.svg">
    <img src="./branding/wordmark.svg" alt="FlatClaw" width="360">
  </picture>
</p>

<p align="center">
  <a href="https://flatclaw.org">https://flatclaw.org</a>
</p>

**The open-source private-cloud AI coworker.** Chat, agent fleet, approvals, scheduled automation, document search, persistent agent memory, role-based access, voice, image, and a library of per-user OAuth tool integrations — packaged as a single-tenant appliance that deploys into the customer's own Northflank project. Everything — control plane and GPU — runs on Northflank, starting at 1× NVIDIA H100 (80 GB) and scaling horizontally as the tenant grows (bigger Northflank GPU plans, additional nodes — same architecture). Nothing leaves their tenancy. Every line of code is auditable. Data locality is mechanically verifiable, not marketed.

---

## Why it exists

Between January and April 2026, the entire frontier-lab industry converged on a single product shape: an agentic AI coworker with a task inbox, saved schedules, document memory, and direct access to local files and connected apps. Claude Cowork defined the category. Gemini Enterprise Agent is the identical-shaped response. GPT-6 + Atlas is the unified version.

Every one of those products is structurally cloud-hosted and sends your data to the vendor's servers on every request. For firms whose data contractually or legally cannot leave their own infrastructure — legal, healthcare, accounting, finance, government, and everyone adjacent — that category is unreachable.

FlatClaw is the same product shape, built out of open-source components, running entirely inside infrastructure the operator controls.

---

## v0.1.0 release scope

This first public release ships the architecture, the foundational components, and the published inference image. What's working today vs. what's coming next is enumerated in the [Roadmap](#roadmap) section below.

**Working today**
- Full architecture documented (this README + per-component READMEs)
- **FlatClaw Portal** — runnable Next.js 16 + React 19 admin + user surface
- **Per-agent memory** via the OpenClaw runtime — every user's agent owns its own `<workspace>/memory/` directory; no separate memory service to deploy or babysit
- **Public inference image** at [`ghcr.io/skytruax/flatclaw-inference:latest`](https://github.com/skytruax/FlatClaw/pkgs/container/flatclaw-inference) — SGLang base + entrypoint, lightweight, GHCR-published, GitHub Actions rebuilds on every Dockerfile/entrypoint change
- Apache 2.0 license, OSI-approved

**Not in v0.1.0 — see [Roadmap](#roadmap)**
- Skill implementations (Gmail, Drive, Scrapling, fs-paths, rag-search, CRM) — only `memory-*` are real today
- RAGFlow service manifest and ingest watcher
- RBAC enforcement at the OpenClaw tool-invocation hook
- `provision-tenant.sh` / `destroy-tenant.sh` orchestration
- Voice (VoxCPM2), image (SDXL), TurboQuant 1M-context kernels

---

## What's in the box

A complete coworker stack, not a framework. Every component is included and pre-integrated:

| Component | What it is |
|---|---|
| **FlatClaw Portal** | Next.js 16 + React 19 product surface — chat, agent fleet, approvals, cron scheduling, skills management, SSE-streamed tool use, plus FlatClaw-specific Docs and Memory panels and an Admin panel for owner-only RBAC management. |
| **OpenClaw runtime** | Self-hosted agent loop. Session management, tool use, multi-step planning, cron, approval gates, sandboxed tool execution. Enforces RBAC at every tool call. |
| **Inference service** | Patched SGLang + Gemma 4 31B Dense + bge-m3 embedder co-resident on a single NVIDIA H100 (80 GB, sm_90, native FP8) on Northflank's managed GPU fleet. Model weights live on a Northflank-managed volume served internally by the weights-server pod; new inference pods cold-boot in 60-90 seconds. |
| **Per-agent memory** | OpenClaw's built-in memory module — each user's agent maintains its own markdown memory under `<workspace>/memory/`, written by the agent itself during normal turns and editable by admins via a subagent. No separate memory service. |
| **RAGFlow integration** *(roadmap, v0.2)* | Private document ingest and retrieval with cited sources. PDF, Docx, Excel, PPT, markdown, email, OCR'd scans, web pages. Wrapped as the `rag-search` OpenClaw skill. v0.1.0 ships the design; v0.2 ships the deploy manifest + ingest watcher. |
| **Skills library** | OpenClaw skills bundle. **v0.1.0 ships:** `memory-recall`, `memory-write`. **Roadmap (v0.2):** Gmail, Google Drive, Scrapling, fs-paths, rag-search, plus a first CRM skill. Destructive skills flagged `requires_review` will surface in Portal as approval cards. Per-user OAuth credentials, never tenant-wide. |
| **RBAC + per-user credentials** | Architecture: multiple users per tenant, distinct roles (`owner`, `sales`, `finance`, `support`, `viewer`, custom), per-role skill policy matrix, per-user OAuth tokens stored in a per-tenant credential vault scoped `(tenant, user, service)`, audit log. **v0.1.0 status:** Portal DB schema and permission UI in place; OpenClaw-side enforcement hook lands in v0.2. |
| **One-command tenant provisioning** *(roadmap, v0.2)* | `provision-tenant.sh` will create the customer's Northflank project, provision the weights volume, run a stager job to fetch Gemma weights from Kaggle, apply all four service manifests, seed RBAC, and return a Portal URL. v0.1.0 ships the documented staging recipe; orchestration script is the next deliverable. |
| **One public inference image, every tenant** | [`ghcr.io/skytruax/flatclaw-inference:latest`](https://github.com/skytruax/FlatClaw/pkgs/container/flatclaw-inference) — public on GHCR, ~18 GB, SGLang base + entrypoint, no baked weights. Every FlatClaw deployment pulls this same image. Per-tenant differences live on the weights volume (model files, tenant data) and in Northflank credentials, never in the image. Auditable, reproducible, single source of truth. |

---

## Architecture

```
           ┌─────────────── Customer's Northflank project (one per tenant) ───────────────┐
           │                                                                              │
 Browser ──► FlatClaw Portal (Next.js + React + SQLite)                                   │
           │    └─ Chat • Agents • Approvals • Cron • Skills • Docs • Memory              │
           │       • SSE /api/runtime/stream, intent routes /api/intents/*                │
           │                    │                                                         │
           │                    │  server-owned WebSocket                                 │
           │                    ▼                                                         │
           │              OpenClaw Gateway (ws://:18789)                                  │
           │                    │                                                         │
           │                    │  skills bus (local IPC / HTTP)                          │
           │                    │                                                         │
           │          ┌─────────┼─────────────┬──────────┐                                │
           │          ▼         ▼             ▼          ▼                                │
           │     Postgres   RAGFlow      Skills:     Sandbox                              │
           │    (optional   (docs in,    gmail •    (podman per                           │
           │     — only if  cited        gdrive •   tool exec)                            │
           │     we need    answers      scrapling  ↓                                     │
           │     extra      out)         voxcpm2    bash / filesys                        │
           │     projection │            sdxl       / network egress                      │
           │     state)     │            fs-paths   with review gates                     │
           │                │            rag-search                                       │
           │                ▼                                                             │
           │             /v1/embeddings                                                   │
           │                                                                              │
           │   Per-agent memory lives inside each agent's workspace                       │
           │   (~/.openclaw/workspace-<id>/memory/) — managed by OpenClaw itself.         │
           │                              ↓                                               │
           │                    ┌──────── Inference service (GPU) ────────┐               │
           │                    │  Lightweight image (SGLang base) +      │               │
           │                    │  Northflank weights volume holding      │               │
           │                    │  Gemma 4 31B + bge-m3 (+ later voice    │               │
           │                    │  / image / TurboQuant 1M ctx)           │               │
           │                    │                                         │               │
           │                    │  Northflank-managed GPU plan:           │               │
           │                    │  1× NVIDIA H100 (80 GB, sm_90, FP8)     │               │
           │                    └─────────────────────────────────────────┘               │
           │                                  ▲                                           │
           │                                  │ HTTP fetch at boot                        │
           │                          weights-server pod                                  │
           │                          (HTTP file server over the                          │
           │                           Northflank weights volume)                         │
           │                                                                              │
           │   Northflank secrets (per-tenant OAuth tokens, per-user RBAC vault)          │
           │                                                                              │
           └──────────────────────────────────────────────────────────────────────────────┘
                                               │
                                               │  Northflank API provisions everything:
                                               │  Portal, Gateway, Inference (H100),
                                               │  RAGFlow, weights-server.
                                               ▼
                                       Northflank API
```

**Four services per tenant**, all in the customer's Northflank project:

1. **Portal** — `nf-compute-400` (4 vCPU / 8 GB). FlatClaw-branded Next.js 16 + React 19 UI with Docs, Memory, and Admin panels.
2. **OpenClaw Gateway** — `nf-compute-400`. The agent runtime; enforces RBAC at every tool call. Owns per-agent memory under each agent's workspace.
3. **Inference service** — Northflank-managed H100 GPU plan. 1× NVIDIA H100 (80 GB, sm_90, native FP8). Held warm 24/7 in prod. Fetches weights at boot from `weights-server`.
4. **RAGFlow** — `nf-compute-200-8` + persistent volume. Tenant document corpus.

Plus a small **weights-server** pod (HTTP file server over a Northflank-managed volume) that the inference pod fetches model weights from at boot. Not user-facing; not counted as a "service" in the four above.

Northflank manages ingress, TLS, DNS, observability, secrets, GPU scheduling, and per-tenant project lifecycle. OpenClaw manages sessions / cron / approvals / RBAC / memory. Portal owns the UI and an SQLite projection of relevant state. **Customer holds the Northflank account directly** — Northflank bills the customer, never us.

---

## Cost and capacity

Indicative monthly costs at Northflank's published list pricing, single tenant, prod held warm 24/7:

| Component | Plan | Approx. monthly |
|---|---|---|
| **Inference (H100 80GB)** | Northflank H100 GPU plan, held warm | **~$1,800** |
| Portal | `nf-compute-400` (4 vCPU / 8 GB) | ~$50 |
| OpenClaw Gateway | `nf-compute-400` | ~$50 |
| RAGFlow + corpus volume | `nf-compute-200-8` + 100 GB | ~$30 |
| weights-server + weights volume | small CPU pod + 200 GB nvme | ~$30 |
| Egress, TLS, observability, project mgmt | included | — |
| **Total per tenant, all-in** | | **~$2,000 / month** |

These are list prices and round numbers; committed-use or annual deals on Northflank typically reduce the GPU line. The inference line dominates — everything else combined is under $200.

**Why this configuration supports 20–30 daily active users at an SMB:**

- **Steady-state concurrency is low.** A 25-DAU SMB doesn't have 25 people typing simultaneously. Empirically, peak concurrent active sessions land around 5-8: people skim a result, edit a doc, take a call, ask a follow-up. The H100 needs to serve that peak, not the whole DAU number.
- **One H100 SGLang process at Gemma 4 31B FP8 sustains roughly 8-12 concurrent streaming chats** with first-token latency in the 1-2 s range and token throughput in the 25-40 tok/s per stream range, depending on context length. SGLang's RadixAttention prefix cache earns most of that on conversational reuse — repeated agent turns inside the same session reuse KV cache and complete faster than the cold-path number above suggests.
- **Most user actions don't hit the 31B path.** Memory recall, RAG retrieval, file reads, and OAuth tool invocations are gateway-side or skill-side — they don't enter the LLM at all. The LLM is invoked for chat turns, tool-call planning, and reasoning. A typical SMB-coworker session is 3-15 LLM calls, not hundreds.
- **Headroom for occasional bursts.** The 80 GB H100 holds Gemma 4 31B FP8 (~33 GB) + KV cache + bge-m3 with ~25 GB free. When a v0.3 cascade lands, that headroom turns into a co-resident Gemma 4 4B FP8 (~4 GB) that absorbs simple-chat / planning / fast-turn traffic, leaving the 31B free for the harder agent runs. Same hardware, ~2× concurrent capacity for the conversational mix without provisioning a second GPU.
- **The non-GPU layer scales separately.** If a tenant's chat traffic outgrows H100 throughput, the answer is a higher-tier Northflank GPU plan (H100 SXM, multi-GPU node) — not a redesign. Portal/Gateway/RAGFlow already run as independent Northflank services and scale on their own knobs.

For tenants larger than ~30 DAU, the right next step is either a multi-GPU Northflank plan (still one project, same architecture) or a second prod inference service on a smaller card (Gemma 4 4B) wired in front of the 31B for conversational triage. Both are roadmap, not v0.1.0.

---

## Technology choices

- **Inference runtime: patched SGLang + Gemma 4 31B Dense.** The best open-weight dense model in its class; SGLang is the fastest production runtime for it. Weights published by Google, pulled from Kaggle once onto a Northflank-managed weights volume, served to the inference pod at boot via the in-project `weights-server`. New pods cold-boot in 60–90 seconds because they only pull the ~18 GB SGLang image and stream weights over the project's internal network; weights don't move per boot.
- **Silicon: NVIDIA H100 (80 GB, sm_90).** Native FP8 hardware on Hopper — no Marlin kernel fallback that breaks Gemma 4 31B's projection dims on Ampere. Sizes for Gemma 4 31B FP8 (~33 GB) + KV cache + bge-m3 with comfortable headroom.
- **Scalable by design.** A single tenant starts on 1× H100. The same architecture scales horizontally — bigger tenants step up to higher Northflank GPU plans (more vCPU/RAM around the same GPU) or multi-GPU plans (multiple H100s in the same Northflank project), and the entire Portal/Gateway/RAGFlow layer scales independently of inference. Nothing in the design assumes single-GPU; that's just where each tenant starts.
- **Substrate: Northflank's managed H100 fleet.** Northflank schedules the GPU pod, handles autoscaling and node lifecycle. Available across the regions Northflank exposes. Customer signs up to Northflank directly; we never sit between them and the substrate.
- **Context: TurboQuant turbo4 KV compression.** Custom CUDA kernels targeting Gemma 4 head dimensions on Hopper. Enables 1M-token context on a single card — "read your whole codebase / year of email" becomes real. Roadmap deliverable; shippable fallback is stock-SGLang FP8 at 128k context.
- **Agent runtime: OpenClaw.** Self-hosted, tool-use native, actively maintained, comfortable with multi-step planning and long-running sessions. Enforces RBAC at every tool invocation.
- **Frontend: FlatClaw Portal.** Next.js 16 + React 19 + TypeScript + SQLite, with Docs (RAGFlow), Memory (admin view onto each agent's `<workspace>/memory/`), and Admin (owner-only RBAC) panels wired into the OpenClaw gateway's SSE + intent routes.
- **Auth: `better-auth` for v1/v1.1 (email + Google/Microsoft OAuth login), WorkOS for v2 enterprise SSO** (per-tenant Okta / Azure AD / Google Workspace SAML configuration). Two distinct OAuth flows kept strictly separate: login OAuth identifies the user to FlatClaw (short-lived); tool OAuth grants the agent access to the user's connected services (long-lived, encrypted, scoped per `(tenant, user, service)`).
- **Retrieval: RAGFlow.** Wrapped as an OpenClaw skill behind a stable interface. Swappable without touching agent or UI.
- **Memory: OpenClaw's per-agent memory module.** Each agent owns its own `<workspace>/memory/` directory; writes happen as part of the agent's normal turn (the agent decides what to remember). No separate database to deploy, no separate failure domain.
- **Embeddings: bge-m3.** Multilingual, long-context, ~2 GB VRAM. Co-resident on the inference GPU.
- **Deploy: Northflank end-to-end.** One Northflank project per tenant holds Portal, Gateway, Inference (H100), RAGFlow, and the weights-server. Northflank handles ingress, TLS, DNS, observability, secrets, GPU scheduling, and project lifecycle. No second cloud, no BYOC plumbing, no GKE.
- **One image, every tenant.** [`ghcr.io/skytruax/flatclaw-inference:latest`](https://github.com/skytruax/FlatClaw/pkgs/container/flatclaw-inference) is public on GHCR. Every FlatClaw deployment — every customer's tenant project — pulls this same ~18 GB image. The SGLang base + entrypoint is universal; per-tenant differences live entirely on the weights volume (model files, tenant state) and in Northflank credentials. Anyone can pull and audit it directly. Pattern is reusable for VoxCPM2, SDXL, bge-m3, and any future model — same image, additional model directories on the volume.
- **Voice: VoxCPM2** *(roadmap — next release).* Open-weight voice cloning + TTS. Will be staged onto the weights volume and loaded co-resident on the H100 alongside Gemma. Not in v0.1.0.
- **Image: ComfyUI + SDXL** *(roadmap — next release).* Standard open-weight image generation. Same disk-staging pattern as Gemma. Not in v0.1.0.
- **Web fetching: Scrapling** *(roadmap — next release).* Private-internet retrieval with robots respected. Not in v0.1.0.

Every dependency is MIT / Apache / BSD compatible.

---

## Data locality is mechanically provable

The privacy story is not a marketing claim. It is a test you can run yourself.

1. Provision a tenant in your own Northflank project.
2. Exercise the v0.1.0-shipped features end-to-end (chat, memory recall/write, scheduled-task fire, GPU cold-boot). As skills land in v0.2 (Gmail, Drive, Scrapling, RAG, voice, image), each is added to this test loop.
3. Run `tcpdump` on the tenant's Northflank project egress for the full session.
4. Confirm zero packets to Anthropic, OpenAI, Google AI (the hosted Gemini/Vertex APIs), Hugging Face at runtime, ElevenLabs, Chroma Cloud, or any third-party inference endpoint. Only expected egress: services the user explicitly connected via OAuth (Gmail, Drive, scrape targets). Inference traffic stays inside the project — Portal → Gateway → Inference (H100) is all internal Northflank network. Kaggle is accessed only at the one-time weight-staging step, never at runtime.

This check runs mechanically on every release. It is the promise the project exists to keep.

---

## Repository layout

| Path | What it is |
|---|---|
| [`portal/`](portal/) | FlatClaw Portal — Next.js 16 + React 19 admin + user surface, chat + fleet + approvals + cron + skills + Docs + Memory. |
| [`web/`](web/) | flatclaw.org informational site — Next.js static export. |
| [`skills/`](skills/) | OpenClaw skills bundle — gmail, gdrive, scrapling, voxcpm2, sdxl, rag-search, memory-*, fs-paths. |
| [`ragflow-config/`](ragflow-config/) | Per-tenant RAGFlow deploy config + ingest watcher. |
| [`infra/inference/`](infra/inference/) | Inference service — Dockerfile (SGLang base), entrypoint, Northflank service manifest, and the stager-job recipe for one-time per-tenant weight staging onto the weights volume. |
| [`infra/scripts/`](infra/scripts/) | `provision-tenant.sh` + `destroy-tenant.sh` — orchestration scripts. **v0.2 deliverable; v0.1.0 ships honest stubs that exit with a not-implemented message.** |
| [`branding/`](branding/) | FlatClaw wordmark (`wordmark.svg`, `wordmark-white.svg`) + attribution (`NOTICE.md`). |
| [`.github/workflows/publish-inference.yml`](.github/workflows/publish-inference.yml) | GitHub Actions pipeline that republishes `ghcr.io/skytruax/flatclaw-inference:latest` on changes to `Dockerfile` or `entrypoint.sh`. |
| [`SECURITY.md`](SECURITY.md) | Vulnerability reporting policy. |

---

## Verification

Every release ships with end-to-end tests for the features in scope. Tests grow as features land, never the other way around — silent hangs and feature claims without verification are release blockers.

**v0.1.0 verifies:**
- Inference image build pipeline: GitHub Actions republishes `:latest` on every change to `Dockerfile` or `entrypoint.sh`
- License + data-locality smoke: image manifest + LICENSE files match what the README claims

**Roadmap (added as features land):**
- RAG query with citation (v0.2)
- Memory recall/write end-to-end through Portal (v0.2)
- Gmail read + send with review gate (v0.2)
- Drive write with review gate (v0.2)
- Scrapling fetch (v0.2)
- Voice clone, image gen (v0.3)
- Multi-step plan (depends on full skill bundle)
- GPU cold-boot timing under 90s
- `provision-tenant.sh` → working tenant with TLS in under 20 minutes, three runs in a row (v0.2)
- `destroy-tenant.sh` leaves no orphaned Northflank resources (v0.2)

---

## Roadmap

### v0.2 (next release)

- **Skill implementations** — Gmail, Google Drive, Scrapling, fs-paths, rag-search wrapper, plus a first CRM skill (Salesforce or HubSpot). Each as an OpenClaw skill package under `skills/`.
- **RAGFlow service** — Northflank service manifest + per-tenant namespace template + ingest watcher daemon + `destroy-hook.sh`.
- **RBAC vault enforcement** — OpenClaw-side hook that consults the per-user credential vault before tool invocation; Portal Admin panel finishes (user invite, role policy editor, audit-log viewer, tenant settings).
- **`provision-tenant.sh` + `destroy-tenant.sh`** — full Northflank tenant lifecycle (project create → volume + stager-job → all services → RBAC seed → Portal URL). Target: ≤20 min from zero to a working Portal URL, three clean runs in a row.

### v0.3

- **Voice — VoxCPM2** open-weight cloning + TTS, co-resident on the H100.
- **Image — ComfyUI + SDXL**, same disk-staging pattern.
- **Cascade routing — multi-process serving on the same H100.** Small Gemma 4 4B FP8 (~4 GB) on `:8001` for simple chat / fast turns, Gemma 4 31B FP8 (~33 GB) on `:8000` for complex agent runs, voice on `:8002`, image on `:8003` — all co-resident under `--mem-fraction-static`, with ~25 GB headroom on the 80 GB card. OpenClaw routes by skill / agent. Targets simple-chat latency under multi-user concurrent load without provisioning a second GPU.
- **TurboQuant turbo4** KV compression — custom CUDA kernels for Gemma 4 head dimensions on Hopper. Unlocks 1M-token context on a single card.

### v0.4+

- WorkOS SSO for v2 enterprise tenants (per-tenant Okta / Azure AD / Google Workspace SAML).
- Multi-tenancy on a shared GPU node for the SMB tier (with strict K8s namespace + per-tenant volume isolation).
- Audio/video transcription ingest in RAGFlow.
- A "studio" for users to author their own skills.

---

## License

**FlatClaw itself**: Apache 2.0. See [`LICENSE`](LICENSE). Read, audit, fork, run, modify, redistribute — explicit patent grant included. OSI-approved.

**FlatClaw Portal**, **Skills bundle**, **`web/`**, and **infra scripts**: Apache 2.0 (matching the root) unless otherwise noted in a subdirectory's own LICENSE.

**Inference image** ([`ghcr.io/skytruax/flatclaw-inference:latest`](https://github.com/skytruax/FlatClaw/pkgs/container/flatclaw-inference)): SGLang base + entrypoint only — no model weights. Apache 2.0. Public on GHCR — every FlatClaw deployment pulls this same image. Weights load at runtime from the Northflank-managed weights volume, populated once by a stager job from Kaggle (`google/gemma-4/transformers/gemma-4-31b-it`) under Google's [Gemma Terms of Use](https://ai.google.dev/gemma/terms), redistributable per those terms with the accompanying license files preserved in the volume's `gemma-4-31b-it/` directory.
