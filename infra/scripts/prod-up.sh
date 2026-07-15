#!/usr/bin/env bash
# prod-up.sh — bring up the FlatClaw prod inference box (Gemma 4 31B-IT FP8 on H100, SGLang).
#
# Verified working config (2026-05-11):
#   - Service `inference` on the `flatclaw-demo` Northflank project, plan nf-gpu-h100-80-1g.
#   - Image: lmsysorg/sglang:dev  used DIRECTLY (no flatclaw-inference layer). The full SGLang
#     launch command is inlined into the customEntrypoint below, symmetric to dev-up.sh. Why:
#     the skytruax/flatclaw-inference Docker Hub repo went 404 — yesterday's pod worked from a
#     Northflank node's cached pull; a fresh node today couldn't pull, killing the task in 3 s
#     with no logs. Inlining removes the dependency on our custom image entirely.
#     Note: a Northflank `resume`/`restart` reuses the previously-deployed image *digest* — only a
#     deployment-config change (image path, env, storage, …) re-resolves a tag. The :256 tag exists
#     because the cached `:latest` digest kept the service stuck on an old build.
#   - customEntrypoint: fetches the ~33 GB of weights from the in-project `weights-server` (the pod
#     re-downloads them on *every* restart — that's the ~10-15 min cold boot), then exec's
#     /usr/local/bin/entrypoint.sh which launches SGLang.
#   - Runtime env on the service (set/refreshed by step 1 below — DON'T let these drift):
#       MODEL_DIR=/workspace/models  GEMMA_DIR_NAME=gemma-4-31B-it
#       MAX_CONTEXT=262144                              # 256K — Gemma 4 31B-IT's genuine native window
#                                                      #   (text_config.max_position_embeddings=262144;
#                                                      #   no RoPE scaling needed). A stale MAX_CONTEXT=131072
#                                                      #   silently overrode the entrypoint default and pinned
#                                                      #   the served context to 128K — that bug cost us hours.
#       SGLANG_EXTRA_ARGS="--kv-cache-dtype fp8_e5m2 --max-running-requests 1 --cuda-graph-max-bs 1 --mem-fraction-static 0.92"
#                                                      #   e5m2 (not e4m3) — Triton attention backend on sm_90.
#                                                      #   --max-running-requests 1: single-tenant box → one turn
#                                                      #   at a time, each gets the full H100 (no decode thrash).
#                                                      #   --cuda-graph-max-bs 1: only the batch-1 graph is ever
#                                                      #   used → faster cold boot, more KV headroom. 0.92 mem-frac.
#   - Resulting SGLang launch:  --context-length 262144 --quantization fp8 (FP8 weights) --tp 1
#       --kv-cache-dtype fp8_e5m2 --max-running-requests 1 --cuda-graph-max-bs 1 --mem-fraction-static 0.92 --tool-call-parser gemma4 --reasoning-parser gemma4
#   - max_total_num_tokens (the *active concurrent* KV pool, VRAM-bound) lands ~113 k — and it's ~the same
#     at 128K vs 256K context, because Gemma 4 is 5:1 sliding:full attention (50 of 60 layers cap KV at a
#     1024-token window), so widening the window barely grows the pool. So: 256K *window*, ~113K fittable
#     per request — openclaw's compaction reserve keeps turns under that.
#   - openclaw side (step 4): agents.defaults.model=openai/gemma-4-31b-it, contextTokens=262144,
#     thinkingDefault=medium, timeoutSeconds=1800,
#     provider contextWindow=262144 + provider timeoutSeconds=600 (lifts the LLM idle watchdog to 600s).
#
# Idempotent: if the service / model entry / env already match, this just resumes and refreshes config.
# Dev and prod lanes are mutually exclusive — this pauses `inference-dev` and unregisters `openai-dev`;
# dev-up.sh is symmetric.
#
# Cost: H100 80GB = ~$3-4/hr while running. Bring it back down: ./prod-down.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/.env.local"
GATEWAY_CFG="$HOME/.openclaw/openclaw.json"
PROJECT="flatclaw-demo"
WSVR="weights-server"
PROD_SVC="inference"
PROD_PUBLIC_HOST="http--inference--tjfh9cp596sf.code.run"
PROD_INFERENCE_URL="https://${PROD_PUBLIC_HOST}/v1"
WSVR_PUBLIC_URL="https://http--weights-server--tjfh9cp596sf.code.run"
PROD_WEIGHTS_PATH="gemma-4-31B-it"

# Source .env.local FIRST (for NORTHFLANK_API_TOKEN), then override the
# lane-defining variables. Stale values from prior runs (e.g. an older
# PROD_MODEL_ID) must not override the script's source of truth.
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found"; exit 1; }
set -a; source "$ENV_FILE"; set +a
: "${NORTHFLANK_API_TOKEN:?NORTHFLANK_API_TOKEN not set in .env.local}"

PROD_MODEL_ID="gemma-4-31b-it"

say() { printf '\n\033[36m[prod-up] %s\033[0m\n' "$*"; }
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

say "1/6 ensure runtime env on inference (MAX_CONTEXT=262144 etc. — must not drift to a stale 131072)"
# GET current env, force the lane-defining keys, POST it back. POSTing the same values is a no-op
# (Northflank dedupes → no redeploy); a drifted value gets corrected (triggers a redeploy if running).
CUR_ENV="$(api GET "/projects/$PROJECT/services/$PROD_SVC/runtime-environment" 2>/dev/null || echo '{}')"
NEW_ENV="$(printf '%s' "$CUR_ENV" | python3 -c '
import sys, json
try: env = (json.load(sys.stdin).get("data") or {}).get("runtimeEnvironment") or {}
except Exception: env = {}
env["MODEL_DIR"] = "/workspace/models"
env["GEMMA_DIR_NAME"] = "gemma-4-31B-it"
env["MAX_CONTEXT"] = "262144"
env["SGLANG_EXTRA_ARGS"] = "--kv-cache-dtype fp8_e5m2 --max-running-requests 1 --cuda-graph-max-bs 1 --mem-fraction-static 0.92"
print(json.dumps({"runtimeEnvironment": env}))
')"
# No `|| true` here — Northflank dedupes identical POSTs, so the only ways this fails are
# real bugs (bad token, network out, schema change). Let set -e abort loudly rather than
# silently proceeding with stale env on the service.
api POST "/projects/$PROJECT/services/$PROD_SVC/runtime-environment" "$NEW_ENV" >/dev/null
echo "  MAX_CONTEXT=262144, SGLANG_EXTRA_ARGS=\"--kv-cache-dtype fp8_e5m2 --max-running-requests 1 --cuda-graph-max-bs 1 --mem-fraction-static 0.92\""

say "2/6 ensure image=lmsysorg/sglang:dev + customEntrypoint with inlined SGLang launch"
# Two things in one PATCH so they go through atomically:
#   (a) deployment.external.imagePath = lmsysorg/sglang:dev — no dependency on a Hub repo we own
#   (b) customEntrypoint = wget weights + patch config.json + exec python3 -m sglang.launch_server
# Without (a) we depend on skytruax/flatclaw-inference being pullable on the *specific* H100 node
# Northflank schedules; without (b) the SGLang launch flags / config-patch live in a separate
# image we publish, which is a single-point-of-failure. dev-up.sh uses the same pattern.
#
# The max_position_embeddings 131072→262144 patch is critical: Gemma 4 31B-IT's text_config says
# 262144 but vision_config carries a vestigial 131072, and SGLang clamps served context to the
# *minimum* across composite configs. Without this patch the 256k window collapses to 128k
# regardless of MAX_CONTEXT.
cat > /tmp/prod-fetch.sh <<'FETCH'
set -euo pipefail
echo "[fetch] start at $(date -u +%FT%TZ)"
mkdir -p /workspace/models/gemma-4-31B-it
cd /workspace/models/gemma-4-31B-it
if ! command -v wget >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -qq -y wget ca-certificates
fi
# Use the *public* weights-server URL, not the in-project internal hostname.
# Internal DNS for `weights-server` is unreliable on freshly-scheduled H100 pods
# (verified 2026-05-15: wget got the first 4 small config files via internal DNS,
# then 'unable to resolve host address' on every subsequent file → crash loop).
# dev-up.sh hit the same thing and works around it the same way. Public URL
# routes through Northflank ingress and is rock-solid.
WS=https://http--weights-server--tjfh9cp596sf.code.run
echo "[fetch] fetching weights from $WS/gemma-4-31B-it/"
wget --no-verbose --no-host-directories --cut-dirs=2 \
     --recursive --no-parent --reject "index.html*" \
     "$WS/gemma-4-31B-it/" \
     || { echo "[fetch] FAILED — is gemma-4-31B-it staged on weights-server?"; exit 1; }
echo "[fetch] done at $(date -u +%FT%TZ)"
ls -lah /workspace/models/gemma-4-31B-it | head -20

# Expose the full 256K context window. Gemma 4 31B-IT's text_config already
# says max_position_embeddings=262144, but SGLang clamps the served context
# to the minimum it finds across the composite config — and vision_config
# carries a vestigial max_position_embeddings=131072. Bump every 131072 ->
# 262144 (vision pos-embeds are sized by position_embedding_size, not this,
# so it's harmless to the vision tower).
python3 - <<'PY'
import json
p = "/workspace/models/gemma-4-31B-it/config.json"
c = json.load(open(p))
def fix(o):
    n = 0
    if isinstance(o, dict):
        if o.get("max_position_embeddings") == 131072:
            o["max_position_embeddings"] = 262144; n += 1
        for v in o.values(): n += fix(v)
    elif isinstance(o, list):
        for v in o: n += fix(v)
    return n
n = fix(c)
print(f"[config-patch] bumped {n} max_position_embeddings 131072->262144")
json.dump(c, open(p, "w"), indent=2)
PY

echo "[fetch] launching SGLang on :8000 (context-length=${MAX_CONTEXT:-262144})"
# SGLANG_EXTRA_ARGS (set on the service env) carries the prod-specific flags:
#   --kv-cache-dtype fp8_e5m2 --max-running-requests 1 --cuda-graph-max-bs 1 --mem-fraction-static 0.92
# argparse takes the LAST value when a flag is repeated, so SGLANG_EXTRA_ARGS overrides any
# explicit defaults we put before it.
exec python3 -m sglang.launch_server \
  --model-path /workspace/models/gemma-4-31B-it \
  --host 0.0.0.0 --port 8000 \
  --served-model-name gemma-4-31b-it \
  --context-length "${MAX_CONTEXT:-262144}" \
  --tp 1 \
  --quantization fp8 \
  --tool-call-parser gemma4 \
  --reasoning-parser gemma4 \
  --enable-metrics \
  ${SGLANG_EXTRA_ARGS:-}
FETCH
B64=$(base64 -w 0 /tmp/prod-fetch.sh)
# IMPORTANT: send image-path and docker.customEntrypoint as TWO separate PATCHes.
# Combining them in one PATCH (`{"external":{...},"docker":{...}}`) is silently lossy —
# the CLI/API applies one and drops the other (verified 2026-05-15: image landed, entrypoint
# kept its previous value, pod TASK_KILLED in 3 s because it tried to exec the stale path).
echo '{"external":{"imagePath":"lmsysorg/sglang:dev"}}' > /tmp/prod-image.json
northflank update service deployment --projectId "$PROJECT" --serviceId "$PROD_SVC" -f /tmp/prod-image.json >/dev/null
python3 -c "
import json
print(json.dumps({'docker': {'configType': 'customEntrypoint',
                              'customEntrypoint': f\"bash -c 'echo $B64 | base64 -d | bash'\"}}))" \
  > /tmp/prod-entry.json
northflank update service deployment --projectId "$PROJECT" --serviceId "$PROD_SVC" -f /tmp/prod-entry.json >/dev/null
echo "  image=lmsysorg/sglang:dev, customEntrypoint re-applied (wget + config-patch + inline SGLang)"

say "3/6 resume weights-server + pause dev (mutually exclusive lanes)"
api POST "/projects/$PROJECT/services/$WSVR/resume" '{"instances":1}' >/dev/null || true
api POST "/projects/$PROJECT/services/inference-dev/pause" '{}' >/dev/null 2>&1 || true

# Wait for weights-server to actually serve the prod weights directory before
# resuming inference. Without this, the inference pod boots fast, races the
# weights-server cold start, and `wget` hits 503 → entrypoint exits 1 → pod
# Terminated. Northflank does retry (eventually it would succeed once the
# weights-server warms), but we burn 1-2 H100 boot attempts each time and
# the deployment view shows red. Polling the actual weights path (not just
# the host) catches both "container not up yet" and "nginx up but autoindex
# not yet serving the model dir" cases.
say "  waiting for weights-server to serve $PROD_WEIGHTS_PATH/ (max 5 min)"
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$WSVR_PUBLIC_URL/$PROD_WEIGHTS_PATH/" || echo "000")
  if [ "$code" = "200" ]; then
    echo "  weights-server ready after ${i}x5s (HTTP 200)"
    break
  fi
  if [ "$i" = "60" ]; then echo "  TIMEOUT waiting for weights-server (last HTTP $code)"; exit 2; fi
  sleep 5
done

say "4/6 resume inference (H100 — billing starts now: ~\$3-4/hr)"
api POST "/projects/$PROJECT/services/$PROD_SVC/resume" '{"instances":1}' >/dev/null || true

say "5/6 wait for SGLang ready (~10-15 min cold: the pod re-downloads ~33 GB of weights every restart, then SGLang loads + FP8-quantizes + captures CUDA graphs)"
for i in $(seq 1 60); do
  if curl -fsS --max-time 4 "$PROD_INFERENCE_URL/models" >/dev/null 2>&1; then
    echo "  SGLang ready after ${i}x30s"
    break
  fi
  if [ "$i" = "60" ]; then echo "  TIMEOUT after 30 min"; exit 2; fi
  sleep 30
done

say "6/6 register prod provider in openclaw.json (and unregister dev — only one lane at a time) + restart gateway"
python3 - <<PY
import json
p = "$GATEWAY_CFG"
cfg = json.load(open(p))
prov = cfg.setdefault("models", {}).setdefault("providers", {})
if "openai-dev" in prov:
    del prov["openai-dev"]
    print("  unregistered dev provider (openai-dev)")
prov["openai"] = {
  "baseUrl": "$PROD_INFERENCE_URL",
  "apiKey": "no-auth-needed",
  "api": "openai-completions",
  # Provider request timeout. ALSO lifts openclaw's "LLM idle watchdog" for
  # this (remote) provider from its 120 s default to 300 s — the 31B can stay
  # silent for minutes during prefill + a deep think / long write generation
  # on a big context, which otherwise aborts the turn with reason=timeout. See
  # openclaw/src/agents/pi-embedded-runner/run/llm-idle-timeout.ts.
  "timeoutSeconds": 600,
  "models": [{
    "id": "$PROD_MODEL_ID",
    "name": "Gemma 4 31B (FlatClaw H100)",
    "api": "openai-completions",
    "contextWindow": 262144,
    "maxTokens": 8192,
    "reasoning": True,
    "input": ["text"],
    "compat": {"supportsTools": True, "supportsReasoningEffort": True}
  }]
}
# Point agents.defaults.model at the lane that's now active. Without this,
# existing agents inherit a stale provider/model and fail with "Unknown
# model" the moment we swap lanes.
defaults = cfg.setdefault("agents", {}).setdefault("defaults", {})
defaults["model"] = "openai/$PROD_MODEL_ID"
# Match the model's native context window. Gemma 4 31B-IT genuinely supports
# 256k (262144) tokens — text_config.max_position_embeddings=262144, no RoPE
# scaling involved. SGLang serves --context-length 262144 (driven by the
# MAX_CONTEXT env on the service — see step 1 / the header). Note: the
# *active concurrent* KV pool (SGLang's max_total_num_tokens) profiles to
# ~113k regardless, because Gemma 4's 5:1 sliding:full attention means
# widening the window barely grows the pool — that's a per-request ceiling,
# not a window cap, and openclaw's compaction reserve stays under it.
# Bump --mem-fraction-static via SGLANG_EXTRA_ARGS (not entrypoint.sh) to
# recover more pool, watching for OOM headroom.
defaults["contextTokens"] = 262144
# Overall per-turn timeout (default is none → the 120 s LLM idle watchdog is
# the effective ceiling). 1800 s: long multi-step agentic turns (site builds,
# bulk uploads) were hitting the old 600 s cap while ACTIVELY working — a tool
# call succeeded seconds before the abort (2026-07-08, pitfall_game turn). The
# provider idle watchdog (600 s of silence, set above) remains the real hang
# catcher; this cap only bounds runaway-but-busy turns.
defaults["timeoutSeconds"] = 1800
# Gemma 4 31B has a thinking channel. Prod default is "medium" — "high"
# produces 1-3+ minutes of silent prefill+reasoning on big tool-heavy
# contexts, which trips openclaw's idle watchdog and aborts the turn
# (reason=timeout). "medium" stays responsive. Users can bump an individual
# session to "high" via the chat thinking-level dropdown (the raised
# 300 s idle watchdog above gives those turns the slack to complete).
# See plan.md → "OpenClaw configuration deep reference" for the lane matrix.
defaults["thinkingDefault"] = "medium"
# Per-tool-result char cap. openclaw also bounds this relative to
# contextTokens, so the effective limit is min(this, openclaw's formula);
# with a 256K window 250000 is the binding number. (openclaw default: 16k.)
defaults.setdefault("contextLimits", {})["toolResultMaxChars"] = 250000
# --- Compaction (defensible defaults; see plan.md → "trust openclaw") ---
# Five keys we set deliberately. Everything else (mode/maxHistoryShare/
# reserveTokens/keepRecentTokens/truncateAfterCompaction/model/timeoutSeconds)
# we leave to openclaw's safeguard implementation, which sizes from
# contextTokens correctly.
defaults["compaction"] = {
    "notifyUser": True,                 # portal renders compaction markers
    "postIndexSync": "async",           # don't block user on RAG/memory sync
    "qualityGuard": {"enabled": True, "maxRetries": 1},  # one retry on bad summary
    "recentTurnsPreserve": 3,           # keep last 3 turns verbatim post-compact
    "midTurnPrecheck": {"enabled": False},  # off — fires on first turn falsely
}
# Wipe any prior contextPruning override; openclaw's defaults handle
# per-turn pruning fine.
defaults.pop("contextPruning", None)
# Rewrite any per-session model id that isn't the active prod model. No
# allowlist — if model or modelId is a non-empty string that doesn't
# match the current target, replace it. Symmetric with dev-up.sh.
import os, json as _json
for agent_id in os.listdir(os.path.expanduser("~/.openclaw/agents")):
    sj = os.path.expanduser(f"~/.openclaw/agents/{agent_id}/sessions/sessions.json")
    if not os.path.exists(sj):
        continue
    sdata = _json.load(open(sj))
    def _fix(obj):
        n = 0
        if isinstance(obj, dict):
            mv = obj.get("model")
            if isinstance(mv, str) and mv and mv != "$PROD_MODEL_ID":
                obj["model"] = "$PROD_MODEL_ID"; n += 1
                if obj.get("modelProvider"): obj["modelProvider"] = "openai"
                if obj.get("provider") in ("openai", "openai-dev"): obj["provider"] = "openai"
            mid = obj.get("modelId")
            if isinstance(mid, str) and mid and mid != "$PROD_MODEL_ID":
                obj["modelId"] = "$PROD_MODEL_ID"; n += 1
                if obj.get("provider") in ("openai", "openai-dev"): obj["provider"] = "openai"
            # Reset per-session thinkingLevel: high/xhigh/max → "medium" (the
            # prod default). Users opt into a deeper level per-session via the
            # chat thinking-level dropdown; we don't want sessions stuck on a
            # level that idle-times-out. Leave "off"/"low" alone if set.
            if obj.get("thinkingLevel") in ("high", "xhigh", "max"):
                obj["thinkingLevel"] = "medium"; n += 1
            # Pin per-session contextTokens to the prod window (262144 —
            # Gemma 4 31B's native 256k). Sessions inherit whichever value
            # was current at create time, so rewrite anything that differs.
            ct = obj.get("contextTokens")
            if isinstance(ct, int) and ct != 262144:
                obj["contextTokens"] = 262144; n += 1
            for v in obj.values(): n += _fix(v)
        elif isinstance(obj, list):
            for v in obj: n += _fix(v)
        return n
    if _fix(sdata):
        _json.dump(sdata, open(sj, "w"), indent=2)

json.dump(cfg, open(p, "w"), indent=2)
print(f"  added openai (prod) provider with $PROD_MODEL_ID (timeoutSeconds=600 → idle watchdog 600s)")
print(f"  set agents.defaults.model = openai/$PROD_MODEL_ID")
print(f"  set agents.defaults.thinkingDefault = medium")
print(f"  set agents.defaults.timeoutSeconds = 1800")
print(f"  set agents.defaults.contextTokens = 262144 (Gemma 4 31B native 256k window)")
print(f"  set agents.defaults.compaction.{{notifyUser=true, postIndexSync=async, qualityGuard.enabled=true, recentTurnsPreserve=3, midTurnPrecheck.enabled=false}} (budget knobs left to safeguard defaults)")
print(f"  cleared agents.defaults.contextPruning (openclaw default per-turn pruning)")
print(f"  rewrote stored per-session model + thinkingLevel (high→medium) + contextTokens (→ 262144)")
PY

sed -i '/^PROD_INFERENCE_URL=/d; /^PROD_MODEL_ID=/d' "$ENV_FILE"
echo "PROD_INFERENCE_URL=$PROD_INFERENCE_URL" >> "$ENV_FILE"
echo "PROD_MODEL_ID=$PROD_MODEL_ID" >> "$ENV_FILE"
systemctl --user restart openclaw-gateway.service
sleep 4

say "DONE — prod model available in Studio (refresh http://localhost:3000)"
echo "  Provider URL:  $PROD_INFERENCE_URL"
echo "  Model ID:      $PROD_MODEL_ID"
echo "  Cost while up: ~\$3-4/hr"
echo "  Bring it down: $ROOT/infra/scripts/prod-down.sh"
