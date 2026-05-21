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
# Default to 262144 (256k) — Gemma 4 31B's native context window. Was 32768
# (a stale legacy value); the H100 80 GB envelope holds it cleanly because:
#   - FP8 weights (~33 GB) + FP8 KV cache (~32 GB at 256k) = ~65 GB used
#   - Headroom for prefill + a few concurrent requests = ~15 GB free
# Override per-deployment via Northflank service env if you ever need to
# host co-resident models on the same card.
: "${MAX_CONTEXT:=262144}"
: "${TP:=1}"
: "${GEMMA_DIR_NAME:=gemma-4-31b-it}"
: "${SGLANG_EXTRA_ARGS:=}"
# FP8 KV cache halves memory cost vs FP16 KV. At 256k that's the difference
# between fitting (~32 GB KV) and not fitting (~64 GB KV which would push us
# over after weights). On Hopper sm_90 native FP8 is supported.
#
# We pick `fp8_e4m3` over `fp8_e5m2` because Triton's `tl.dot` kernel (which
# SGLang's Gemma 4 attention falls back to on some hardware) only accepts
# fp8_e4m3 as an rhs dtype — fp8_e5m2 throws "Unsupported rhs dtype fp8e5"
# at launch (verified on L4 sm_89). e4m3 works on both Hopper (sm_90) and
# Ada (sm_89). SGLang's accepted choices: auto, fp8_e5m2, fp8_e4m3, bf16,
# bfloat16, fp4_e2m1 — `fp8` (no suffix) is NOT in that set.
: "${KV_CACHE_DTYPE:=fp8_e4m3}"

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
  --kv-cache-dtype "$KV_CACHE_DTYPE" \
  --served-model-name "gemma-4-31b-it" \
  --tool-call-parser gemma4 \
  --reasoning-parser gemma4 \
  --enable-metrics \
  $SGLANG_EXTRA_ARGS
