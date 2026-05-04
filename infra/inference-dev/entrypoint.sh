#!/usr/bin/env bash
# FlatClaw dev-inference entrypoint.
#
# Same pattern as the prod 31B entrypoint (`infra/inference/entrypoint.sh`):
# weights are NOT baked into the image, they live on a per-tenant Northflank
# volume served by the in-project `weights-server` pod, populated once by a
# Northflank stager job from
# `google/gemma-4/transformers/gemma-4-e4b-it/1` on Kaggle.
#
# At pod boot the dev Northflank manifest's customEntrypoint fetches weights
# into $MODEL_DIR before invoking this script. When weights are present, this
# entrypoint launches SGLang against $MODEL_DIR/$GEMMA_DIR_NAME on the L4 GPU.
# /v1/chat/completions and /v1/embeddings respond once warm-up completes
# (~60s typical on L4 once weights are local).

set -euo pipefail

: "${MODEL_DIR:=/workspace/models}"
: "${PORT:=8000}"
: "${MAX_CONTEXT:=32768}"
: "${TP:=1}"
: "${GEMMA_DIR_NAME:=gemma-4-e4b-it}"
: "${SGLANG_EXTRA_ARGS:=}"

say() { printf '\n\033[36m[entrypoint-dev] %s\033[0m\n' "$*"; }

model_path="$MODEL_DIR/$GEMMA_DIR_NAME"
if [ ! -d "$model_path" ]; then
  echo "FATAL: $model_path does not exist." >&2
  echo "The dev manifest's customEntrypoint should fetch weights from the" >&2
  echo "in-project weights-server before invoking this script. If running" >&2
  echo "locally, mount a directory holding the model files at" >&2
  echo "$MODEL_DIR/$GEMMA_DIR_NAME." >&2
  ls -la "$MODEL_DIR" 2>&1 >&2 || true
  exit 1
fi

say "launching SGLang on :$PORT (context=$MAX_CONTEXT, tp=$TP)"
say "model_path=$model_path"

# Gemma 4 E4B ships in BF16; on a 24 GB L4 we don't need FP8 quant — the model
# is ~8 GB BF16, leaves ample headroom for KV cache at 32k context.
#
# Same SGLang parsers as prod (--tool-call-parser gemma4, --reasoning-parser
# gemma4) so the response shape and parsing path are byte-identical between
# dev and prod. Per Google's chat template, thinking is OFF by default —
# callers must pass `extra_body.chat_template_kwargs.enable_thinking=true`
# to activate it on a per-request basis.
exec python3 -m sglang.launch_server \
  --model-path "$model_path" \
  --host 0.0.0.0 \
  --port "$PORT" \
  --context-length "$MAX_CONTEXT" \
  --tp "$TP" \
  --dtype bfloat16 \
  --served-model-name "gemma-4-e4b-it" \
  --tool-call-parser gemma4 \
  --reasoning-parser gemma4 \
  --enable-metrics \
  $SGLANG_EXTRA_ARGS
