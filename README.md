<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./branding/wordmark-white.svg">
    <img src="./branding/wordmark.svg" alt="FlatClaw" width="360">
  </picture>
</p>

**The open-source private-cloud AI coworker.** Chat, agent fleet, approvals, scheduled automation, document search, persistent agent memory, role-based access, voice, image, and a library of per-user OAuth tool integrations — packaged as a single-tenant appliance that deploys into the customer's own Northflank project + GCP project in about twenty minutes. The control plane runs on Northflank; the GPU runs on the customer's GCP G4 instance via Northflank BYOC — starting at 1× NVIDIA RTX PRO 6000 Blackwell and scaling horizontally as the tenant grows (more vCPU/RAM, more GPUs, more nodes — same architecture). Nothing leaves their tenancy. Every line of code is auditable. Data locality is mechanically verifiable, not marketed.

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
- **FlatClaw Console** — runnable Next.js 16 + React 19 codebase, MIT-licensed
- **FlatClaw Memory** — method-of-loci memory store, **verified at p50 ≈ 12.6 ms recall on 10k facts** (`uv run python -m flatclaw_memory.benchmark`)
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
| **FlatClaw Console** | Next.js 16 + React 19 product surface — chat, agent fleet, approvals, cron scheduling, skills management, SSE-streamed tool use, plus FlatClaw-specific Docs and Memory panels and an Admin panel for owner-only RBAC management. |
| **OpenClaw runtime** | Self-hosted agent loop. Session management, tool use, multi-step planning, cron, approval gates, sandboxed tool execution. Enforces RBAC at every tool call. |
| **Inference service** | Patched SGLang + Gemma 4 31B Dense + bge-m3 embedder co-resident on a single NVIDIA RTX PRO 6000 Blackwell (96 GB, sm_100+, native FP8). Runs on a GCP `g4-standard-12` instance attached to Northflank via BYOC. Model weights live on a per-tenant GCP persistent disk; new pods cold-boot in 60-90 seconds. |
| **FlatClaw Memory** | Persistent agent memory on ChromaDB + SQLite with a method-of-loci schema (wings → halls → rooms → facts). Layered recall, per-fact visibility, per-fact delete. |
| **RAGFlow integration** *(roadmap, v0.2)* | Private document ingest and retrieval with cited sources. PDF, Docx, Excel, PPT, markdown, email, OCR'd scans, web pages. Wrapped as the `rag-search` OpenClaw skill. v0.1.0 ships the design; v0.2 ships the deploy manifest + ingest watcher. |
| **Skills library** | OpenClaw skills bundle. **v0.1.0 ships:** `memory-recall`, `memory-write`. **Roadmap (v0.2):** Gmail, Google Drive, Scrapling, fs-paths, rag-search, plus a first CRM skill. Destructive skills flagged `requires_review` will surface in Console as approval cards. Per-user OAuth credentials, never tenant-wide. |
| **RBAC + per-user credentials** | Architecture: multiple users per tenant, distinct roles (`owner`, `sales`, `finance`, `support`, `viewer`, custom), per-role skill policy matrix, per-user OAuth tokens stored in a per-tenant credential vault scoped `(tenant, user, service)`, audit log. **v0.1.0 status:** Console DB schema and permission UI in place; OpenClaw-side enforcement hook lands in v0.2. |
| **One-command tenant provisioning** *(roadmap, v0.2)* | `provision-tenant.sh` will create the customer's Northflank project, attach the GCP BYOC cluster, provision the per-tenant GPU disk, stage Gemma weights from Kaggle, apply all five service manifests, seed RBAC, and return a Console URL. v0.1.0 ships the documented disk-staging recipe; orchestration script is the next deliverable. |
| **One public inference image, every tenant** | [`ghcr.io/skytruax/flatclaw-inference:latest`](https://github.com/skytruax/FlatClaw/pkgs/container/flatclaw-inference) — public on GHCR, ~18 GB, SGLang base + entrypoint, no baked weights. Every FlatClaw deployment pulls this same image. Per-tenant differences live on the persistent disk (weights, tenant data) and in Northflank/GCP credentials, never in the image. Auditable, reproducible, single source of truth. |

---

## Architecture

```
           ┌──────────────── Customer's Northflank project (one per tenant) ───────────┐
           │                                                                            │
 Browser ──► FlatClaw Console (Next.js + React + SQLite)                                  │
           │    └─ Chat • Agents • Approvals • Cron • Skills • Docs • Memory            │
           │       • SSE /api/runtime/stream, intent routes /api/intents/*              │
           │                    │                                                       │
           │                    │  server-owned WebSocket                               │
           │                    ▼                                                       │
           │              OpenClaw Gateway (ws://:18789)                                │
           │                    │                                                       │
           │                    │  skills bus (local IPC / HTTP)                        │
           │                    │                                                       │
           │          ┌─────────┼──────────┬──────────────┬──────────┐                  │
           │          ▼         ▼          ▼              ▼          ▼                  │
           │     Postgres   RAGFlow   FlatClaw Memory   Skills:    Sandbox              │
           │    (optional   (docs in, (ChromaDB +       gmail •   (podman per           │
           │     — only if  cited     SQLite, method-   gdrive •  tool exec)            │
           │     we need    answers   of-loci schema,  scrapling  ↓                     │
           │     extra      out)      we own the code) voxcpm2  bash / filesys         │
           │     projection │         │                 sdxl      / network egress      │
           │     state)     │         │                 fs-paths  with review gates     │
           │                │         │                 rag-search                       │
           │                │         │                 memory-*                        │
           │                ▼         ▼                                                  │
           │              /v1/embeddings   /v1/embeddings                                │
           │                              ↓                                              │
           │                    ┌──────── Inference service (GPU) ────────┐              │
           │                    │  Lightweight image (SGLang base) +      │              │
           │                    │  GCP persistent disk holding            │              │
           │                    │  Gemma 4 31B + bge-m3 + (Spike B)        │              │
           │                    │  TurboQuant 1M ctx                      │              │
           │                    │  GCP g4-standard-* instance:            │              │
           │                    │  1× RTX PRO 6000 Blackwell (96 GB)      │              │
           │                    │  via Northflank BYOC                    │              │
           │                    └──────────────────────────────────────────┘              │
           │                                                                              │
           │   Northflank secrets (per-tenant OAuth tokens, per-user RBAC vault)          │
           │                                                                              │
           └──────────────────────────────────────────────────────────────────────────────┘
                                                │
                                                │  Northflank API provisions Console/Gateway/RAGFlow/Memory.
                                                │  GCP API provisions the GPU instance + disk via Northflank BYOC.
                                                ▼
                              Northflank API (control plane) + GCP API (GPU substrate)
```

**Five services per tenant**, all in the customer's Northflank project:

1. **Console** — `nf-compute-400` (4 vCPU / 8 GB). FlatClaw-branded Next.js 16 + React 19 UI with Docs, Memory, and Admin panels.
2. **OpenClaw Gateway** — `nf-compute-400`. The agent runtime; enforces RBAC at every tool call.
3. **Inference service** — Northflank service pinned to a GCP `g4-standard-12` node via BYOC. 1× NVIDIA RTX PRO 6000 Blackwell (96 GB, sm_100+, native FP8). Held warm 24/7. Mounts the per-tenant GCP persistent disk at `/workspace`.
4. **RAGFlow** — `nf-compute-200-8` + persistent volume. Tenant document corpus.
5. **FlatClaw Memory** — `nf-compute-200-4` + persistent volume. Method-of-loci memory store.

Northflank manages ingress, TLS, DNS, observability, secrets, and per-tenant project lifecycle. GCP supplies the GPU compute and the persistent disk. OpenClaw manages sessions / cron / approvals / RBAC. Console owns the UI and an SQLite projection of relevant state. **Customer holds both a Northflank account and a GCP account directly** — both bill the customer, never us.

---

## Technology choices

- **Inference runtime: patched SGLang + Gemma 4 31B Dense.** The best open-weight dense model in its class; SGLang is the fastest production runtime for it. Weights published by Google, pulled from Kaggle once onto the per-tenant GCP persistent disk, mounted at `/workspace/models/gemma-4-31B-it/`. New pods cold-boot in 60–90 seconds because they only pull the ~18 GB SGLang image and mount the disk; weights don't move per boot.
- **Silicon: NVIDIA RTX PRO 6000 Blackwell (96 GB, sm_100+).** Native FP8 hardware (no Marlin kernel fallback that breaks Gemma 4 31B's projection dims on Ampere). v0.1.0 sizes for Gemma 4 31B FP8 + KV cache + bge-m3; the 96 GB envelope leaves room for VoxCPM2 and SDXL co-resident in later releases.
- **Scalable by design.** A single tenant starts on 1× RTX PRO 6000 Blackwell (the `g4-standard-12` default). The same architecture scales horizontally — bigger tenants step up to `g4-standard-24/48` for more vCPU and RAM around the same single GPU; multi-GPU deployments add additional g4 nodes to the same Northflank project; and the entire Console/Gateway/RAGFlow/Memory layer scales independently of inference. Northflank's BYOC handles GKE cluster autoscaling on the GCP side. Nothing in the design assumes single-GPU; that's just where each tenant starts.
- **Substrate: GCP `g4-standard-12`.** Single-GPU instance; 12 vCPU + 45 GB RAM gives SGLang comfortable headroom without paying for unused vCPUs. Available in 22+ GCP regions. Premium tier: `g4-standard-48` (48 vCPU / 180 GB RAM, same 1× GPU) for heavier co-resident workloads.
- **Context: TurboQuant turbo4 KV compression.** Custom CUDA kernels for Gemma 4 head dimensions on Blackwell. Enables 1M-token context on a single card — "read your whole codebase / year of email" becomes real. Spike B's deliverable; shippable fallback is stock-SGLang FP8 at 128k context.
- **Agent runtime: OpenClaw.** Self-hosted, tool-use native, actively maintained, comfortable with multi-step planning and long-running sessions. Enforces RBAC at every tool invocation.
- **Frontend: FlatClaw Console.** Next.js 16 + React 19 + TypeScript + SQLite, with Docs (RAGFlow), Memory (FlatClaw Memory), and Admin (owner-only RBAC) panels wired into the OpenClaw gateway's SSE + intent routes.
- **Auth: `better-auth` for v1/v1.1 (email + Google/Microsoft OAuth login), WorkOS for v2 enterprise SSO** (per-tenant Okta / Azure AD / Google Workspace SAML configuration). Two distinct OAuth flows kept strictly separate: login OAuth identifies the user to FlatClaw (short-lived); tool OAuth grants the agent access to the user's connected services (long-lived, encrypted, scoped per `(tenant, user, service)`).
- **Retrieval: RAGFlow.** Wrapped as an OpenClaw skill behind a stable interface. Swappable without touching agent or UI.
- **Memory: ChromaDB + SQLite, method-of-loci schema.** Pattern is public; implementation is ours. Two vendor-independent data stores, no SDK dependency, portable schema.
- **Embeddings: bge-m3.** Multilingual, long-context, ~2 GB VRAM. Co-resident on the inference GPU.
- **Deploy: Northflank (control plane) + GCP (GPU substrate via Northflank BYOC).** Northflank handles Console / Gateway / RAGFlow / Memory + ingress + TLS + DNS + observability + per-tenant project lifecycle. GCP runs the `g4-standard-12` GPU instance and the persistent disk. Northflank's BYOC integration manages the GKE cluster on the customer's GCP project.
- **One image, every tenant.** [`ghcr.io/skytruax/flatclaw-inference:latest`](https://github.com/skytruax/FlatClaw/pkgs/container/flatclaw-inference) is public on GHCR. Every FlatClaw deployment — every customer's tenant project — pulls this same ~18 GB image. The SGLang base + entrypoint is universal; per-tenant differences live entirely on the persistent disk (weights, tenant state) and in Northflank/GCP credentials. Anyone can pull and audit it directly. Pattern is reusable for VoxCPM2, SDXL, bge-m3, and any future model — same image, additional model directories on the disk.
- **Voice: VoxCPM2** *(roadmap — next release).* Open-weight voice cloning + TTS. Will be staged onto the GCP disk and loaded co-resident on the Blackwell card alongside Gemma. Not in v0.1.0.
- **Image: ComfyUI + SDXL** *(roadmap — next release).* Standard open-weight image generation. Same disk-staging pattern as Gemma. Not in v0.1.0.
- **Web fetching: Scrapling** *(roadmap — next release).* Private-internet retrieval with robots respected. Not in v0.1.0.

Every dependency is MIT / Apache / BSD compatible.

---

## Data locality is mechanically provable

The privacy story is not a marketing claim. It is a test you can run yourself.

1. Provision a tenant in your own Northflank project.
2. Exercise the v0.1.0-shipped features end-to-end (chat, memory recall/write, scheduled-task fire, GPU cold-boot). As skills land in v0.2 (Gmail, Drive, Scrapling, RAG, voice, image), each is added to this test loop.
3. Run `tcpdump` on the tenant's Northflank project egress **and** on the GCP G4 instance egress for the full session.
4. Confirm zero packets to Anthropic, OpenAI, Google AI (the hosted Gemini/Vertex APIs — distinct from the GCP compute substrate), Hugging Face at runtime, ElevenLabs, Chroma Cloud, or any third-party inference endpoint. Only expected egress: traffic between the customer's Northflank project and their GCP G4 instance (TLS-encrypted bearer-authenticated inference calls), plus — once skills land — services the user explicitly connected via OAuth (Gmail, Drive, scrape targets). Kaggle is accessed only at the one-time disk-staging step, never at runtime.

This check runs mechanically on every release. It is the promise the project exists to keep.

---

## Repository layout

| Path | What it is |
|---|---|
| [`console/`](console/) | FlatClaw Console — Next.js 16 + React 19 product surface, chat + fleet + approvals + cron + skills + Docs + Memory. |
| [`flatclaw-memory/`](flatclaw-memory/) | Method-of-loci memory service (ChromaDB + SQLite, FastAPI). |
| [`skills/`](skills/) | OpenClaw skills bundle — gmail, gdrive, scrapling, voxcpm2, sdxl, rag-search, memory-*, fs-paths. |
| [`ragflow-config/`](ragflow-config/) | Per-tenant RAGFlow deploy config + ingest watcher. |
| [`infra/inference/`](infra/inference/) | Inference service — Dockerfile (SGLang base), entrypoint, GCP BYOC manifest + `stage-disk.sh` for one-time per-tenant weight staging onto a GCP persistent disk. |
| [`infra/scripts/`](infra/scripts/) | `provision-tenant.sh` + `destroy-tenant.sh` — orchestration scripts. **v0.2 deliverable; v0.1.0 ships honest stubs that exit with a not-implemented message.** |
| [`branding/`](branding/) | FlatClaw wordmark (`wordmark.svg`, `wordmark-white.svg`) + attribution (`NOTICE.md`). |
| [`.github/workflows/publish-inference.yml`](.github/workflows/publish-inference.yml) | GitHub Actions pipeline that republishes `ghcr.io/skytruax/flatclaw-inference:latest` on changes to `Dockerfile` or `entrypoint.sh`. |
| [`SECURITY.md`](SECURITY.md) | Vulnerability reporting policy. |

---

## Verification

Every release ships with end-to-end tests for the features in scope. Tests grow as features land, never the other way around — silent hangs and feature claims without verification are release blockers.

**v0.1.0 verifies:**
- FlatClaw Memory: 12.6 ms p50 recall on 10k facts, clean per-tenant delete (`uv run python -m flatclaw_memory.benchmark`)
- Inference image build pipeline: GitHub Actions republishes `:latest` on every change to `Dockerfile` or `entrypoint.sh`
- License + data-locality smoke: image manifest + LICENSE files match what the README claims

**Roadmap (added as features land):**
- RAG query with citation (v0.2)
- Memory recall/write end-to-end through Console (v0.2)
- Gmail read + send with review gate (v0.2)
- Drive write with review gate (v0.2)
- Scrapling fetch (v0.2)
- Voice clone, image gen (v0.3)
- Multi-step plan (depends on full skill bundle)
- GPU cold-boot timing under 90s
- `provision-tenant.sh` → working tenant with TLS in under 20 minutes, three runs in a row (v0.2)
- `destroy-tenant.sh` leaves no orphaned Northflank or GCP resources (v0.2)

---

## Roadmap

### v0.2 (next release)

- **Skill implementations** — Gmail, Google Drive, Scrapling, fs-paths, rag-search wrapper, plus a first CRM skill (Salesforce or HubSpot). Each as an OpenClaw skill package under `skills/`.
- **RAGFlow service** — Northflank service manifest + per-tenant namespace template + ingest watcher daemon + `destroy-hook.sh`.
- **RBAC vault enforcement** — OpenClaw-side hook that consults the per-user credential vault before tool invocation; Console Admin panel finishes (user invite, role policy editor, audit-log viewer, tenant settings).
- **`provision-tenant.sh` + `destroy-tenant.sh`** — full Northflank + GCP BYOC tenant lifecycle. Target: ≤20 min from zero to a working Console URL, three clean runs in a row.

### v0.3

- **Voice — VoxCPM2** open-weight cloning + TTS, co-resident on the Blackwell card.
- **Image — ComfyUI + SDXL**, same disk-staging pattern.
- **Cascade routing — multi-process serving on the same Blackwell card.** Small Gemma 4 4B FP8 (~4 GB) on `:8001` for simple chat / fast turns, Gemma 4 31B FP8 (~33 GB) on `:8000` for complex agent runs, voice on `:8002`, image on `:8003` — all co-resident under `--mem-fraction-static`, with ~42 GB headroom on the 96 GB card. OpenClaw routes by skill / agent. Targets simple-chat latency under multi-user concurrent load without provisioning a second GPU.
- **TurboQuant turbo4** KV compression — custom CUDA kernels for Gemma 4 head dimensions on Blackwell. Unlocks 1M-token context on a single card.

### v0.4+

- WorkOS SSO for v2 enterprise tenants (per-tenant Okta / Azure AD / Google Workspace SAML).
- Multi-tenancy on a shared GPU node for the SMB tier (with strict K8s namespace + per-tenant volume isolation).
- Audio/video transcription ingest in RAGFlow.
- A "studio" for users to author their own skills.

---

## License

**FlatClaw itself**: Apache 2.0. See [`LICENSE`](LICENSE). Read, audit, fork, run, modify, redistribute — explicit patent grant included. OSI-approved.

**FlatClaw Console**: MIT. See [`console/LICENSE`](console/LICENSE)

**FlatClaw Memory**, **Skills bundle**, and **infra scripts**: Apache 2.0 (matching the root) unless otherwise noted in a subdirectory's own LICENSE.

**Inference image** ([`ghcr.io/skytruax/flatclaw-inference:latest`](https://github.com/skytruax/FlatClaw/pkgs/container/flatclaw-inference)): SGLang base + entrypoint only — no model weights. Apache 2.0. Public on GHCR — every FlatClaw deployment pulls this same image. Weights load at runtime from the per-tenant GCP persistent disk, populated once by `stage-disk.sh` from Kaggle (`google/gemma-4/transformers/gemma-4-31b-it`) under Google's [Gemma Terms of Use](https://ai.google.dev/gemma/terms), redistributable per those terms with the accompanying license files preserved in the disk's `/workspace/models/gemma-4-31B-it/` directory.
