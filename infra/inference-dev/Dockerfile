# FlatClaw dev-inference image — SGLang base + entrypoint, no model weights.
#
# Same shape as `infra/inference/Dockerfile` (the prod 31B image). The only
# differences are baked into entrypoint.sh: BF16 instead of FP8 quant, and the
# default GEMMA_DIR_NAME points at the dev model. This keeps prod and dev on
# identical runtime + identical pipeline; they only diverge on the model
# binary and the GPU plan they run on.
#
# Model weights (Gemma 4 E4B-it from Kaggle) live on the per-tenant Northflank
# weights volume served by the in-project `weights-server` pod. They are NOT
# baked in — pods cold-boot in 60–90 s by pulling the SGLang base + the small
# entrypoint layer, then fetching weights over the project's internal HTTP.
#
# In production, .github/workflows/publish-inference-dev.yml uses `crane mutate`
# to build this image registry-to-registry without a local Docker daemon, which
# sidesteps the slow push of a 16+ GB base from a developer laptop. This
# Dockerfile is the equivalent local definition for ad-hoc rebuilds.

ARG SGLANG_TAG=dev
FROM lmsysorg/sglang:${SGLANG_TAG}

ENV MODEL_DIR=/workspace/models \
    GEMMA_DIR_NAME=gemma-4-e4b-it \
    PYTHONUNBUFFERED=1

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
