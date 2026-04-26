#!/usr/bin/env bash
# FlatClaw inference entrypoint.
#
# Weights are NOT baked into the image. They live on a per-tenant persistent
# disk that the inference pod mounts at $MODEL_DIR (default /workspace/models).
# The disk is populated once by stage-disk.sh, which spins up a tiny CPU
# instance, attaches the disk, and runs the Kaggle CLI to download Gemma 4 31B
# from `google/gemma-4/transformers/gemma-4-31b-it/1`.
#
# At pod boot:
#   1. The volume mount makes /workspace/models/<modelname>/ available.
#   2. SGLang launches against $MODEL_DIR/$GEMMA_DIR_NAME.
#   3. /v1/chat/completions and /v1/embeddings respond once warm-up completes
#      (60-90s typical on RTX PRO 6000 Blackwell).

set -euo pipefail

: "${MODEL_DIR:=/workspace/models}"
: "${PORT:=8000}"
: "${MAX_CONTEXT:=32768}"
: "${TP:=1}"
: "${GEMMA_DIR_NAME:=gemma-4-31B-it}"
: "${SGLANG_EXTRA_ARGS:=}"

say() { printf '\n\033[36m[entrypoint] %s\033[0m\n' "$*"; }

model_path="$MODEL_DIR/$GEMMA_DIR_NAME"
if [ ! -d "$model_path" ]; then
  echo "FATAL: $model_path does not exist." >&2
  echo "Mount the model-weights disk at $MODEL_DIR before starting." >&2
  echo "Populate the disk once via stage-disk.sh (see infra/inference/README.md)." >&2
  ls -la "$MODEL_DIR" 2>&1 >&2 || true
  exit 1
fi

say "launching SGLang on :$PORT (context=$MAX_CONTEXT, tp=$TP)"
say "model_path=$model_path"

# FP8 quant on RTX PRO 6000 Blackwell (sm_100+) runs through native cutlass /
# deep_gemm — no Marlin fallback (Marlin's 8608-tile constraint kills Gemma 4
# 31B on Ampere sm_80). 96 GB VRAM holds Gemma weights + KV cache + co-resident
# bge-m3, with headroom for VoxCPM2 and SDXL when those land in Spike B2.
exec python3 -m sglang.launch_server \
  --model-path "$model_path" \
  --host 0.0.0.0 \
  --port "$PORT" \
  --context-length "$MAX_CONTEXT" \
  --tp "$TP" \
  --quantization fp8 \
  --served-model-name "gemma-4-31b-it" \
  --tool-call-parser pythonic \
  --enable-metrics \
  $SGLANG_EXTRA_ARGS
