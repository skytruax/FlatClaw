# FlatClaw inference service

SGLang serving the tenant's model class on an OpenAI-compatible HTTP endpoint on `:8000`. **Flagship class:** Gemma 4 31B Dense (FP8) plus the bge-m3 embedder on a single NVIDIA H100 (80 GB, sm_90, native FP8), the lane scripted end to end today. **Frontier class:** GLM-5.2 (744B mixture of experts, FP8) across eight H200 or B200 GPUs with the same image and the same weights-server pattern; its local and cloud build sheets are on [flatclaw.org/builds](https://flatclaw.org/builds/). Deployed as a Northflank service on the reference lane; the same containers run on Azure, AWS, Google Cloud or bare metal.

## Image

`ghcr.io/<org>/flatclaw-inference:latest` — public, ~18 GB.

The image carries the SGLang base + our entrypoint and **no model weights**. Weights live on a per-tenant Northflank-managed volume, served to the inference pod over the project's internal network by a small `weights-server` pod. New inference pods pull only the SGLang image externally; the weights stream over the project's internal network from the weights-server pod.

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
- `POST /v1/embeddings` — bge-m3 embeddings, used by the knowledge-search family (v0.6)
- `GET /v1/models` — health probe

Authentication: bearer token via `--api-key` flag passed through `SGLANG_EXTRA_ARGS`. Northflank routes the public URL through automatic TLS.

## Cost notes

Flagship class, reference-lane list pricing: the H100 GPU plan is **$2.74 per GPU-hour** held warm 24/7, ≈ **$2,000 / month** with the CPU and RAM bundled; the 200 GB weights volume with its CPU pod ≈ **$30 / month**; the control plane (Portal plus one gateway per user, 4 vCPU / 16 GB) ≈ **$144 / month**. Committed-use or annual deals on any cloud typically reduce the GPU line.

The full per-tenant cost (GPU node + control plane + weights volume + observability) lands around **$2,200 / month all-in** at list for the flagship class. The frontier class on the same pattern: 8 × H200 ≈ $18,300 (or 8 × B200 for speed ≈ $34,300), an 8 vCPU / 32 GB control plane that also hosts the failover router ≈ $288, a 1.5 TB+ weights volume ≈ $60: about **$18,700 or $34,700 / month all-in**. See the root README's "Cost and tokenomics" section for the breakdown and capacity reasoning.

## Why H100 for the flagship class, and eight H200 or B200 for the frontier class

- **Native FP8 on Hopper (sm_90).** SGLang's FP8 path runs through cutlass / deep_gemm, never the Marlin fallback that breaks Gemma 4 31B's 8608-wide projection on Ampere (sm_80–88).
- **One vendor, one bill.** Northflank-managed H100 means a single signup, single account, single teardown command. No BYOC plumbing to maintain, no GKE cluster to debug.
- **Right-sized for one tenant.** 1× H100 holds Gemma 4 31B FP8 (~33 GB) + KV cache + bge-m3 with ~25 GB free for long contexts or a second small model, without provisioning a second GPU.
- **The frontier class is a memory problem.** GLM-5.2's FP8 checkpoint is 744 GB, so it takes eight HBM cards: 8 × H200 (1,128 GB) with KV room, or 8 × B200 (1,536 GB) running NVFP4 with multi-token prediction as the fast node. Same image, same entrypoint, `--tp 8`.
- **Compliance posture.** Northflank carries SOC 2 Type II, ISO 27001, HIPAA-eligible with BAA — clears regulated-SMB procurement.
