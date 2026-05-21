#!/usr/bin/env bash
# dev-up.sh — bring up the FlatClaw dev inference box (Gemma 4 E4B-IT, BF16, on A100 80GB, SGLang).
#
# Verified working config (2026-05-11):
#   - Service `inference-dev` on the `flatclaw-demo` Northflank project, plan nf-gpu-a100-80-1g.
#   - Image: lmsysorg/sglang:dev  (used DIRECTLY — unlike prod, dev's customEntrypoint inlines the
#     full SGLang launch command, so there's no flatclaw-inference image / entrypoint.sh in the loop).
#   - customEntrypoint: wget the ~8 GB of E4B weights from the in-project `weights-server`, then
#     `exec python3 -m sglang.launch_server ...` with the flags below. (Re-downloads on each restart.)
#   - SGLang launch:  --context-length 131072 --max-running-requests 1 --tp 1 --dtype bfloat16
#       --tool-call-parser gemma4 --reasoning-parser gemma4 --enable-metrics
#       · BF16 weights + BF16 KV (no --quantization / --kv-cache-dtype): A100 is sm_80 Ampere —
#         no native FP8 hardware, the Triton attention path can't take FP8 KV there, AND SGLang's
#         `--quantization fp8` weight loader hits an upstream bug in gemma4_audio.py on the E*B
#         variants. None of that matters on 80 GB: ~8 GB BF16 weights leaves tons of room.
#       · No --mem-fraction-static / --cuda-graph-max-bs override needed — on A100 80GB the default
#         static fraction profiles `max_total_num_tokens` to ~600k+, so the full 131k window fits
#         with ~5x headroom (A100 *40 GB* was structurally too small — capped ~52k tokens — hence 80 GB).
#       · --max-running-requests 1 — dev is single-user; no point sizing for concurrency.
#       · gemma4 tool-call/reasoning parsers match prod's image exactly, so dev↔prod chat-template +
#         tool-grammar + thinking-channel behavior is 1:1. Thinking is OFF in the chat template by
#         default; callers pass extra_body.chat_template_kwargs.enable_thinking=true per request.
#   - openclaw side (step 4): agents.defaults.model=openai-dev/gemma-4-e4b-it, contextTokens=131072,
#     thinkingDefault=medium (E4B is ~4B — keep it moving; prod's 31B runs "high"), provider contextWindow=131072.
#
# Why Gemma 4 E4B for dev: same Gemma 4 chat template + tool-call grammar + reasoning channel as prod's
# Gemma 4 31B, so format/plumbing-level dev work is 1:1 with prod. Quality is lower — deliberate; dev is
# for plumbing, prod is where reasoning quality is asserted.
#
# Idempotent: creates `inference-dev` if missing, always re-applies the customEntrypoint (the flags here
# are the source of truth), force pause+resume to make a running container pick up flag changes, then
# refreshes openclaw config. Dev and prod lanes are mutually exclusive — this pauses `inference` and
# unregisters `openai`; prod-up.sh is symmetric.
#
# Cost: A100 80GB ≈ ~$2-3/hr while running. Pause when not iterating: ./dev-down.sh
#
# PREREQUISITE: gemma-4-e4b-it weights staged on weights-server (from Kaggle
# `google/gemma-4/transformers/gemma-4-e4b-it/1` via the gemma-stager pattern).
# Requires: Northflank CLI, .env.local with NORTHFLANK_API_TOKEN.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/.env.local"
GATEWAY_CFG="$HOME/.openclaw/openclaw.json"
PROJECT="flatclaw-demo"
WSVR="weights-server"
DEV_SVC="inference-dev"
DEV_PUBLIC_HOST="http--inference-dev--tjfh9cp596sf.code.run"
DEV_INFERENCE_URL="https://${DEV_PUBLIC_HOST}/v1"
WSVR_PUBLIC_URL="https://http--weights-server--tjfh9cp596sf.code.run"
DEV_WEIGHTS_PATH="gemma-4-e4b-it"

# Source .env.local FIRST (for NORTHFLANK_API_TOKEN), then override the
# lane-defining variables. Older runs may have stamped a stale DEV_MODEL_ID
# (e.g. qwen3-8b from a prior model swap) into .env.local — those values
# must not survive a fresh dev-up.
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found"; exit 1; }
set -a; source "$ENV_FILE"; set +a
: "${NORTHFLANK_API_TOKEN:?NORTHFLANK_API_TOKEN not set in .env.local}"

# Script-declared values WIN over anything in .env.local. These are the
# source of truth for what dev-up.sh provisions.
DEV_MODEL_ID="gemma-4-e4b-it"
DEV_MODEL_DISPLAY="Gemma 4 E4B (FlatClaw dev A100)"

say() { printf '\n\033[36m[dev-up] %s\033[0m\n' "$*"; }
api() {
  local method="$1"; shift
  local path="$1"; shift
  local data="${1:-}"
  if [ -n "$data" ]; then
    curl -fsS -X "$method" \
      -H "Authorization: Bearer $NORTHFLANK_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$data" "https://api.northflank.com/v1$path"
  else
    curl -fsS -X "$method" \
      -H "Authorization: Bearer $NORTHFLANK_API_TOKEN" \
      "https://api.northflank.com/v1$path"
  fi
}

say "1/5 resume weights-server + pause prod (mutually exclusive lanes)"
api POST "/projects/$PROJECT/services/$WSVR/resume" '{"instances":1}' >/dev/null || true
api POST "/projects/$PROJECT/services/inference/pause" '{}' >/dev/null 2>&1 || true

say "2/5 ensure inference-dev service exists, then resume it"
if ! api GET "/projects/$PROJECT/services/$DEV_SVC" >/dev/null 2>&1; then
  echo "  service does not exist; creating it"
  cat > /tmp/dev-svc-create.json <<JSON
{
  "name": "$DEV_SVC",
  "description": "FlatClaw dev inference: Gemma 4 E4B (BF16) on A100 80GB",
  "billing": {"deploymentPlan": "nf-gpu-a100-80-1g"},
  "deployment": {
    "instances": 1,
    "external": {"imagePath": "lmsysorg/sglang:dev"},
    "docker": {"configType": "default"},
    "storage": {"ephemeralStorage": {"storageSize": 256000}, "shmSize": 64},
    "gpu": {"enabled": true, "configuration": {"gpuType": "a100-80", "gpuCount": 1}}
  },
  "ports": [{"name": "http", "internalPort": 8000, "public": true, "protocol": "HTTP"}],
  "runtimeEnvironment": {}
}
JSON
  northflank create service deployment --projectId "$PROJECT" -f /tmp/dev-svc-create.json >/dev/null
fi

# Always (re)apply the customEntrypoint — the SGLang launch command inside
# this script is the source of truth for what dev runs. Without this, flag
# changes only land on first service creation, so tweaking flags on an
# existing service would need a delete-recreate. Northflank treats an
# identical PATCH as a no-op, so this stays idempotent for unchanged runs.
{
  # fetch-then-exec customEntrypoint: wget E4B weights from weights-server,
  # then `exec python3 -m sglang.launch_server ...`. SGLang flag notes:
  #
  #   --context-length 131072  — 128K. E4B's native window. A100 80GB has
  #     room to spare: ~8 GB BF16 weights leaves ~70 GB, and SGLang's default
  #     static fraction profiles max_total_num_tokens to ~600k+ tokens, so the
  #     full 131k window fits with ~5x headroom. (We tried A100 *40 GB* first —
  #     it capped max_total_num_tokens at ~52k even with --mem-fraction-static
  #     0.5 + --cuda-graph-max-bs 1, structurally too small for E4B at 128k —
  #     hence the 80 GB plan. On 80 GB no mem-frac / cuda-graph-bs tuning is
  #     needed; SGLang's defaults are fine.)
  #
  #   --dtype bfloat16  — Gemma 4 E*B ships BF16. We do NOT FP8-quantize on
  #     dev: A100 is sm_80 Ampere — no native FP8 hardware; SGLang's Gemma 4
  #     attention path compiles to a Triton tl.dot kernel that rejects FP8 KV
  #     on Ampere/Ada (verified "Unsupported rhs dtype fp8e5"/"fp8e4nv");
  #     and `--quantization fp8`'s weight loader trips an upstream bug in
  #     gemma4_audio.py on the E*B variants. None of it matters at 8 GB BF16.
  #     (So: no --quantization, no --kv-cache-dtype — KV stays BF16. This is
  #     the one place dev's runtime is NOT byte-identical to prod, which runs
  #     FP8 weights + FP8 e5m2 KV on the H100's sm_90 hardware.)
  #
  #   --max-running-requests 1  — dev is single-user; no point sizing the
  #     scheduler/KV pool for concurrency.
  #
  #   --tp 1 / --enable-metrics  — single GPU; Prometheus metrics on.
  #
  #   --tool-call-parser gemma4 / --reasoning-parser gemma4  — the
  #     Gemma-4-specific parsers SGLang ships (sgl-project/sglang#21952);
  #     identical to prod's image entrypoint, so dev↔prod chat-template +
  #     tool-grammar + thinking-channel behavior is 1:1. They extract the
  #     `<|tool_call|>...<tool_call|>` envelope into structured `tool_calls`
  #     and split the `<channel|>` thinking section out as `reasoning_content`.
  #     Per Google's chat template `enable_thinking` defaults OFF — callers
  #     pass `extra_body.chat_template_kwargs.enable_thinking=true` per request.
  cat > /tmp/dev-fetch.sh <<'FETCH'
set -euo pipefail
echo "[fetch-dev] start at $(date -u +%FT%TZ)"
mkdir -p /workspace/models/gemma-4-e4b-it
cd /workspace/models/gemma-4-e4b-it
if ! command -v wget >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -qq -y wget ca-certificates
fi
WS=https://http--weights-server--tjfh9cp596sf.code.run
echo "[fetch-dev] fetching weights from $WS/gemma-4-e4b-it/"
wget --no-verbose --no-host-directories --cut-dirs=2 \
     --recursive --no-parent --reject "index.html*" \
     "$WS/gemma-4-e4b-it/" \
     || { echo "[fetch-dev] FAILED — is gemma-4-e4b-it staged on weights-server?"; exit 1; }
echo "[fetch-dev] done at $(date -u +%FT%TZ)"
ls -lah /workspace/models/gemma-4-e4b-it | head -20
echo "[fetch-dev] launching SGLang on :8000"
exec python3 -m sglang.launch_server \
  --model-path /workspace/models/gemma-4-e4b-it \
  --host 0.0.0.0 --port 8000 \
  --served-model-name gemma-4-e4b-it \
  --context-length 131072 \
  --max-running-requests 1 \
  --tp 1 \
  --dtype bfloat16 \
  --tool-call-parser gemma4 \
  --reasoning-parser gemma4 \
  --enable-metrics
FETCH
  B64=$(base64 -w 0 /tmp/dev-fetch.sh)
  python3 -c "
import json
print(json.dumps({'docker': {'configType':'customEntrypoint','customEntrypoint':f\"bash -c 'echo $B64 | base64 -d | bash'\"}}))" \
    > /tmp/dev-entry.json
  northflank update service deployment --projectId "$PROJECT" --serviceId "$DEV_SVC" -f /tmp/dev-entry.json >/dev/null
}

# Wait for weights-server to actually serve the dev weights directory before
# (re)starting the dev pod. Without this, the dev pod boots fast, races the
# weights-server cold start, and `wget` hits 503 → entrypoint exits 1 → pod
# Terminated. Northflank does retry, but we burn extra A100 boot attempts each
# time and the deployment view shows red. Polling the actual weights path
# (not just the host) catches both "container not up yet" and "nginx up but
# autoindex not yet serving the model dir" cases. Symmetric with prod-up.sh.
say "  waiting for weights-server to serve $DEV_WEIGHTS_PATH/ (max 5 min)"
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$WSVR_PUBLIC_URL/$DEV_WEIGHTS_PATH/" || echo "000")
  if [ "$code" = "200" ]; then
    echo "  weights-server ready after ${i}x5s (HTTP 200)"
    break
  fi
  if [ "$i" = "60" ]; then echo "  TIMEOUT waiting for weights-server (last HTTP $code)"; exit 2; fi
  sleep 5
done

# When the customEntrypoint changes, Northflank queues a redeploy. Force a
# pause+resume so the running container actually restarts with the new
# launch args (otherwise it keeps the old SGLang flags until natural cycling).
say "  redeploying service to apply latest entrypoint flags"
api POST "/projects/$PROJECT/services/$DEV_SVC/pause" '{}' >/dev/null 2>&1 || true
sleep 4
api POST "/projects/$PROJECT/services/$DEV_SVC/resume" '{"instances":1}' >/dev/null || true

say "3/5 wait for SGLang ready (image pull + ~8 GB weight fetch from weights-server + load: ~5-10 min cold)"
for i in $(seq 1 40); do
  if curl -fsS --max-time 4 "$DEV_INFERENCE_URL/models" >/dev/null 2>&1; then
    echo "  SGLang ready after ${i}x30s"
    break
  fi
  if [ "$i" = "40" ]; then echo "  TIMEOUT after 20 min"; exit 2; fi
  sleep 30
done

say "4/5 register provider in openclaw.json (and unregister prod — only one lane at a time)"
python3 - <<PY
import json, sys
p = "$GATEWAY_CFG"
cfg = json.load(open(p))
prov = cfg.setdefault("models", {}).setdefault("providers", {})
if "openai" in prov:
    del prov["openai"]
    print("  unregistered prod provider (openai)")
prov["openai-dev"] = {
  "baseUrl": "$DEV_INFERENCE_URL",
  "apiKey": "no-auth-needed",
  "api": "openai-completions",
  "models": [{
    "id": "$DEV_MODEL_ID",
    "name": "$DEV_MODEL_DISPLAY",
    "api": "openai-completions",
    # Gemma 4 has a real thinking channel (chat-template <|think|> + <channel|>
    # markers, SGLang's gemma4 reasoning-parser splits it into reasoning_content).
    # Must be True or pi-coding-agent's getAvailableThinkingLevels() returns
    # ["off"] only and clamps any thinkingDefault back to off, regardless of
    # agents.defaults.thinkingDefault. See pi dist/core/agent-session.js
    # supportsThinking() / setThinkingLevel().
    "reasoning": True,
    "input": ["text"],
    "contextWindow": 131072,
    "maxTokens": 8192,
    "compat": {"supportsTools": True},
    "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}
  }]
}
# Point agents.defaults.model at the lane that's now active. Without this,
# existing agents inherit a stale provider/model and fail with "Unknown
# model" the moment we swap lanes.
defaults = cfg.setdefault("agents", {}).setdefault("defaults", {})
defaults["model"] = "openai-dev/$DEV_MODEL_ID"
# Match the dev model's context window so per-session contextTokens defaults
# inherit it. A100 80GB serves E4B's full 128k window comfortably (BF16 KV;
# max_total_num_tokens profiles to ~600k+).
defaults["contextTokens"] = 131072
# Dev runs "medium" thinking — E4B is ~4B params; keep it moving. (Prod's
# 31B runs "high" — that's the answer-quality tier prod exists for, so the
# two lanes are NOT symmetric on this knob. See plan.md → "OpenClaw
# configuration deep reference" for the lane parity matrix.)
defaults["thinkingDefault"] = "medium"
# Tool-result single-call cap. openclaw also bounds this relative to
# contextTokens (≈ contextTokens × 0.3 × 4 chars); at 131072 that formula
# allows ~157k chars, so our 64000 is the binding limit. (openclaw default: 16k.)
defaults.setdefault("contextLimits", {})["toolResultMaxChars"] = 64000
# --- Compaction (defensible defaults; see plan.md → "trust openclaw") ---
# Same five keys as prod — environment-agnostic UX decisions (notify on
# compact, don't block on sync, retry bad summaries, preserve last 3 turns,
# no overeager pre-checks). Everything else (mode/budget knobs) left to
# openclaw's safeguard implementation, which sizes from contextTokens (128k here).
defaults["compaction"] = {
    "notifyUser": True,
    "postIndexSync": "async",
    "qualityGuard": {"enabled": True, "maxRetries": 1},
    "recentTurnsPreserve": 3,
    "midTurnPrecheck": {"enabled": False},
}
defaults.pop("contextPruning", None)
# Also rewrite per-session model + thinkingLevel + contextTokens so existing
# sessions (which may have been stamped during the prod lane) don't try to
# invoke the prod model, run at prod's "high" thinking, or carry a 256k cap
# the dev model can't honor.
import os, json as _json
for agent_id in os.listdir(os.path.expanduser("~/.openclaw/agents")):
    sj = os.path.expanduser(f"~/.openclaw/agents/{agent_id}/sessions/sessions.json")
    if not os.path.exists(sj):
        continue
    sdata = _json.load(open(sj))
    # Rewrite any per-session model id that isn't the active dev model.
    # No allowlist — if model or modelId is a non-empty string that
    # doesn't match the current target, replace it. Covers any model id
    # left over from earlier swaps without naming names.
    def _fix(obj):
        n = 0
        if isinstance(obj, dict):
            mv = obj.get("model")
            if isinstance(mv, str) and mv and mv != "$DEV_MODEL_ID":
                obj["model"] = "$DEV_MODEL_ID"; n += 1
                if obj.get("modelProvider"): obj["modelProvider"] = "openai-dev"
                if obj.get("provider") in ("openai", "openai-dev"): obj["provider"] = "openai-dev"
            mid = obj.get("modelId")
            if isinstance(mid, str) and mid and mid != "$DEV_MODEL_ID":
                obj["modelId"] = "$DEV_MODEL_ID"; n += 1
                if obj.get("provider") in ("openai", "openai-dev"): obj["provider"] = "openai-dev"
            # Clamp thinkingLevel to "medium" (dev's E4B tier — prod runs "high").
            if obj.get("thinkingLevel") in ("off", "low", "high", "xhigh", "max"):
                obj["thinkingLevel"] = "medium"; n += 1
            # Cap per-session contextTokens to the dev model's window. Without
            # this, sessions stamped during the prod lane (262144) outrun E4B's
            # max_model_len (131072) and SGLang rejects the request.
            ct = obj.get("contextTokens")
            if isinstance(ct, int) and ct > 131072:
                obj["contextTokens"] = 131072; n += 1
            for v in obj.values():
                n += _fix(v)
        elif isinstance(obj, list):
            for v in obj: n += _fix(v)
        return n
    if _fix(sdata):
        _json.dump(sdata, open(sj, "w"), indent=2)

json.dump(cfg, open(p, "w"), indent=2)
print(f"  added openai-dev provider with $DEV_MODEL_ID (contextWindow 131072)")
print(f"  set agents.defaults.model = openai-dev/$DEV_MODEL_ID")
print(f"  set agents.defaults.thinkingDefault = medium")
print(f"  set agents.defaults.contextTokens = 131072")
print(f"  set agents.defaults.compaction.{{notifyUser=true, postIndexSync=async, qualityGuard.enabled=true, recentTurnsPreserve=3, midTurnPrecheck.enabled=false}} (budget knobs left to safeguard defaults)")
print(f"  cleared agents.defaults.contextPruning (openclaw default per-turn pruning)")
print(f"  rewrote stored per-session model + thinkingLevel (→ medium) + contextTokens (→ 131072)")
PY

say "5/5 update .env.local + restart local gateway"
sed -i '/^DEV_INFERENCE_URL=/d; /^DEV_MODEL_ID=/d' "$ENV_FILE"
echo "DEV_INFERENCE_URL=$DEV_INFERENCE_URL" >> "$ENV_FILE"
echo "DEV_MODEL_ID=$DEV_MODEL_ID" >> "$ENV_FILE"
systemctl --user restart openclaw-gateway.service
sleep 4

say "DONE — dev model available in Studio (refresh http://localhost:3000)"
echo "  Provider URL:  $DEV_INFERENCE_URL"
echo "  Model ID:      $DEV_MODEL_ID"
echo "  Cost while up: ~\$2-3/hr (A100 80GB)"
echo "  Bring it down: $ROOT/infra/scripts/dev-down.sh"
