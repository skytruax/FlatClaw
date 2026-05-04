#!/usr/bin/env bash
# FlatClaw inference entrypoint.
#
# Weights are NOT baked into the image. They live on a per-tenant Northflank
# volume served by an in-project `weights-server` pod. The volume is populated
# once by a Northflank stager job that runs the Kaggle CLI to download Gemma 4
# 31B from `google/gemma-4/transformers/gemma-4-31b-it/1`.
#
# At pod boot the production Northflank manifest's customEntrypoint fetches
# weights into $MODEL_DIR before invoking this script. When weights are
# present, this entrypoint just launches SGLang against
# $MODEL_DIR/$GEMMA_DIR_NAME. /v1/chat/completions and /v1/embeddings respond
# once warm-up completes (60-90s typical on H100).

set -euo pipefail

: "${MODEL_DIR:=/workspace/models}"
: "${PORT:=8000}"
: "${MAX_CONTEXT:=32768}"
: "${TP:=1}"
: "${GEMMA_DIR_NAME:=gemma-4-31b-it}"
: "${SGLANG_EXTRA_ARGS:=}"

say() { printf '\n\033[36m[entrypoint] %s\033[0m\n' "$*"; }

model_path="$MODEL_DIR/$GEMMA_DIR_NAME"
if [ ! -d "$model_path" ]; then
  echo "FATAL: $model_path does not exist." >&2
  echo "The production manifest's customEntrypoint should fetch weights from" >&2
  echo "the in-project weights-server before invoking this script." >&2
  echo "If running locally, mount a directory holding the model files at" >&2
  echo "$MODEL_DIR/$GEMMA_DIR_NAME." >&2
  ls -la "$MODEL_DIR" 2>&1 >&2 || true
  exit 1
fi

say "launching SGLang on :$PORT (context=$MAX_CONTEXT, tp=$TP)"
say "model_path=$model_path"

# FP8 quant on H100 (Hopper, sm_90) runs through native cutlass / deep_gemm —
# no Marlin fallback (Marlin's 8608-tile constraint kills Gemma 4 31B on
# Ampere sm_80). 80 GB VRAM holds Gemma weights (~33 GB FP8) + KV cache +
# co-resident bge-m3, with ~25 GB headroom for the v0.3 cascade (small Gemma
# + voice + image co-resident).
#
# `--tool-call-parser gemma4` and `--reasoning-parser gemma4` are the
# Gemma-4-specific parsers SGLang ships (added in PR #21952). They extract
# Gemma 4's `<|tool_call|>...<tool_call|>` envelope into structured
# `tool_calls`, and split the `<channel|>` thinking section out as
# `reasoning_content`. Per Google's chat template, thinking is OFF by
# default — callers pass `extra_body.chat_template_kwargs.enable_thinking=true`
# to activate it on a per-request basis.
exec python3 -m sglang.launch_server \
  --model-path "$model_path" \
  --host 0.0.0.0 \
  --port "$PORT" \
  --context-length "$MAX_CONTEXT" \
  --tp "$TP" \
  --quantization fp8 \
  --served-model-name "gemma-4-31b-it" \
  --tool-call-parser gemma4 \
  --reasoning-parser gemma4 \
  --enable-metrics \
  $SGLANG_EXTRA_ARGS
