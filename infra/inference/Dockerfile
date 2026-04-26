# FlatClaw inference image — SGLang base + entrypoint, no model weights.
#
# This image is intentionally tiny on top of the SGLang base. Model weights
# (Gemma 4 31B-it, bge-m3, etc.) live on a separate persistent disk that the
# inference pod mounts at runtime — they are NOT baked in. This is what lets a
# new pod cold-boot in 60-90 seconds: it pulls ~18 GB of SGLang+CUDA, then
# mounts the disk and reads weights from there.
#
# The companion staging recipe (`stage-disk.sh` in the same directory) populates
# the disk once per tenant by running the Kaggle CLI from a tiny CPU instance.
#
# Layer count on top of the base is intentionally minimal:
#   - ENV vars (no extracted filesystem change)
#   - COPY entrypoint.sh (single file)
#   - EXPOSE + ENTRYPOINT (metadata only)
#
# In production, .github/workflows/publish-inference.yml uses `crane mutate` to
# build this image registry-to-registry without a local Docker daemon, which
# sidesteps the slow push of a 16+ GB base from a developer laptop. This
# Dockerfile is the equivalent local definition for ad-hoc rebuilds.

ARG SGLANG_TAG=dev
FROM lmsysorg/sglang:${SGLANG_TAG}

ENV MODEL_DIR=/workspace/models \
    GEMMA_DIR_NAME=gemma-4-31B-it \
    PYTHONUNBUFFERED=1

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
