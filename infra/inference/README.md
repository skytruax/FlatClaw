# FlatClaw inference service

SGLang serving Gemma 4 31B Dense (FP8) + bge-m3 embedder on a single NVIDIA H100 (80 GB, sm_90, native FP8). OpenAI-compatible HTTP on `:8000`. Deployed as a Northflank service running on Northflank's managed H100 GPU plan — no second cloud, no BYOC plumbing.

## Image

`ghcr.io/<org>/flatclaw-inference:latest` — public, ~18 GB.

The image carries the SGLang base + our entrypoint and **no model weights**. Weights live on a per-tenant Northflank-managed volume, served to the inference pod over the project's internal network by a small `weights-server` pod. New inference pods cold-boot in 60–90 seconds because the only thing they pull externally is the SGLang image.

## Files

| Path | Purpose |
|---|---|
| [`Dockerfile`](Dockerfile) | Image definition (SGLang base + entrypoint, no weights) |
| [`entrypoint.sh`](entrypoint.sh) | Fetches weights from `weights-server` at boot, launches SGLang against `$MODEL_DIR/$GEMMA_DIR_NAME` |
| [`.dockerignore`](.dockerignore) | Build-context filter |

The CI build at [`.github/workflows/publish-inference.yml`](../../.github/workflows/publish-inference.yml) uses `crane mutate` to publish `:latest` registry-to-registry without a local Docker daemon — much faster than pushing a 16+ GB base from a laptop.

## Tenant deploy flow

Each customer follows the same three steps; the `provision-tenant.sh` script orchestrates all of them.

**1. Provision the per-tenant weights volume.** A 200 GB nvme volume is created in the tenant's Northflank project. Bound to the `weights-server` pod.

**2. Run the stager job.** A one-shot Northflank job mounts the volume, installs the Kaggle CLI, downloads `google/gemma-4/transformers/gemma-4-31b-it/1`, extracts the tar, lays files out under `gemma-4-31b-it/` on the volume. ~10–15 minutes, idempotent. Done once per tenant.

**3. Deploy the inference service.** Northflank creates a service on its H100 GPU plan with a custom entrypoint that fetches weights from `http://weights-server:80/gemma-4-31b-it/` at boot, then launches SGLang. Public URL with automatic TLS comes for free from Northflank.

## Runtime contract

The service exposes:
- `POST /v1/chat/completions` — agent turns from OpenClaw
- `POST /v1/embeddings` — bge-m3 calls from RAGFlow
- `GET /v1/models` — health probe

Authentication: bearer token via `--api-key` flag passed through `SGLANG_EXTRA_ARGS`. Northflank routes the public URL through automatic TLS.

## Cost notes

Northflank H100 GPU plan (list pricing): roughly **$2.49/hr** for held-warm 24/7, ≈ **$1,800 / month**. The 200 GB nvme weights volume is ≈ **$30 / month**. Committed-use or annual deals on Northflank typically reduce the GPU line.

The full per-tenant cost (GPU + Portal + Gateway + RAGFlow + weights-server volumes + observability) lands around **$2,000 / month all-in** at list. See the root README's "Cost and capacity" section for the full breakdown and capacity reasoning.

## Why H100 specifically

- **Native FP8 on Hopper (sm_90).** SGLang's FP8 path runs through cutlass / deep_gemm, never the Marlin fallback that breaks Gemma 4 31B's 8608-wide projection on Ampere (sm_80–88).
- **One vendor, one bill.** Northflank-managed H100 means a single signup, single account, single teardown command. No BYOC plumbing to maintain, no GKE cluster to debug.
- **Right-sized for one tenant.** 1× H100 holds Gemma 4 31B FP8 (~33 GB) + KV cache + bge-m3 with ~25 GB free — leaves room for the v0.3 cascade (small Gemma + voice + image co-resident) without provisioning a second GPU.
- **Compliance posture.** Northflank carries SOC 2 Type II, ISO 27001, HIPAA-eligible with BAA — clears regulated-SMB procurement.
