# FlatClaw inference service

SGLang serving Gemma 4 31B Dense (FP8) + bge-m3 embedder on a single NVIDIA RTX PRO 6000 Blackwell. OpenAI-compatible HTTP on `:8000`. Deployed as a Northflank service whose underlying compute is a GCP `g4-standard-12` instance attached via Northflank's BYOC integration.

## Image

`ghcr.io/<org>/flatclaw-inference:latest` — public, ~18 GB.

The image carries the SGLang base + our entrypoint and **no model weights**. Weights live on a per-tenant GCP persistent disk that the pod mounts at `/workspace/models/`. New pods cold-boot in 60-90 seconds because the only thing they pull is the small image.

## Files

| Path | Purpose |
|---|---|
| [`Dockerfile`](Dockerfile) | Image definition (SGLang base + entrypoint, no weights) |
| [`entrypoint.sh`](entrypoint.sh) | Validates the mounted disk, launches SGLang against `$MODEL_DIR/$GEMMA_DIR_NAME` |
| [`.dockerignore`](.dockerignore) | Build-context filter |

The CI build at [`.github/workflows/publish-inference.yml`](../../.github/workflows/publish-inference.yml) uses `crane mutate` to publish `:latest` registry-to-registry without a local Docker daemon — much faster than pushing a 16+ GB base from a laptop.

## Tenant deploy flow

Each customer follows the same three steps; the `provision-tenant.sh` script orchestrates all of them.

**1. Stage model weights onto a per-tenant GCP persistent disk.** A 200 GB `pd-balanced` disk is created in the tenant's chosen GCP zone (us-central1-b for the default). A tiny `e2-standard-4` instance attaches the disk, runs the Kaggle CLI to download `google/gemma-4/transformers/gemma-4-31b-it/1`, extracts the tar, moves files into `/mnt/models/models/gemma-4-31B-it/`, and shuts down. ~15 minutes, idempotent. Done once per tenant.

**2. Northflank BYOC link.** The tenant's Northflank project is connected to their GCP project via Northflank's GCP provider link (paste a service-account JSON in the UI under Cloud → Provider links → Google Cloud Platform). Northflank manages a per-tenant GKE cluster on the customer's GCP.

**3. Deploy the inference service.** Northflank creates a service pinned to the BYOC cluster + a `g4-standard-12` node + the staged disk mounted at `/workspace`. The service runs `:latest`, finds weights at `$MODEL_DIR/$GEMMA_DIR_NAME`, and serves OpenAI-compatible endpoints on the public Northflank URL.

## Runtime contract

The service exposes:
- `POST /v1/chat/completions` — agent turns from OpenClaw
- `POST /v1/embeddings` — bge-m3 calls from RAGFlow + FlatClaw Memory
- `GET /v1/models` — health probe

Authentication: bearer token via `--api-key` flag passed through `SGLANG_EXTRA_ARGS`. Northflank routes the public URL through automatic TLS.

## Cost notes

GCP G4 in us-central1 (on-demand, list price retrieved 2026-04-25):

| Component | $/hr |
|---|---|
| RTX 6000 96GB GPU | $1.0957 |
| G4 vCPU | $0.0489 |
| G4 RAM | $0.0059 / GB |
| pd-balanced | $0.10 / GB-month |

`g4-standard-12` (12 vCPU, 45 GB RAM, 1× GPU) at always-on = ~$1,422/mo for the GPU instance, ~$20/mo for a 200 GB disk. 1-year committed-use discount on the GPU saves ~$250/mo per tenant.

## Why GCP G4 specifically

- **Single-GPU instances available as a first-class SKU.** CoreWeave's RTX PRO 6000 Blackwell ships only as 8-GPU HGX nodes — wrong unit economics for one-tenant-per-instance deploys. AWS G7e is comparable but Northflank's GCP BYOC integration was first-mover.
- **Native FP8 (sm_100+).** SGLang's FP8 path runs through cutlass / deep_gemm, never the Marlin fallback that breaks Gemma 4 31B's 8608-wide projection on Ampere (sm_80–88).
- **Compliance posture.** SOC 2 Type II, ISO 27001, HIPAA-eligible with BAA — clears regulated-SMB procurement.
- **22+ regions** with G4 availability — the tenant picks where their data lives.
