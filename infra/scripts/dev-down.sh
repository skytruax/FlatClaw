#!/usr/bin/env bash
# dev-down.sh — pause the FlatClaw dev inference box and unregister it from openclaw.
#
# Idempotent: safe to run if dev is already paused / not registered.
# Pauses inference-dev (and weights-server if prod inference is also paused),
# strips the provider entry from openclaw.json, and clears DEV_* env vars.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/.env.local"
GATEWAY_CFG="$HOME/.openclaw/openclaw.json"
PROJECT="flatclaw-demo"
WSVR="weights-server"
DEV_SVC="inference-dev"
PROD_SVC="inference"

[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found"; exit 1; }
set -a; source "$ENV_FILE"; set +a
: "${NORTHFLANK_API_TOKEN:?NORTHFLANK_API_TOKEN not set in .env.local}"

say() { printf '\n\033[36m[dev-down] %s\033[0m\n' "$*"; }
api() {
  local method="$1"; shift
  local path="$1"; shift
  local data="${1:-}"
  if [ -n "$data" ]; then
    curl -fsS -X "$method" \
      -H "Authorization: Bearer $NORTHFLANK_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$data" "https://api.northflank.com/v1$path" 2>/dev/null
  else
    curl -fsS -X "$method" \
      -H "Authorization: Bearer $NORTHFLANK_API_TOKEN" \
      "https://api.northflank.com/v1$path" 2>/dev/null
  fi
}

say "1/4 unregister dev provider from openclaw.json"
python3 - <<PY
import json
p = "$GATEWAY_CFG"
cfg = json.load(open(p))
prov = cfg.get("models", {}).get("providers", {})
if "openai-dev" in prov:
    del prov["openai-dev"]
    json.dump(cfg, open(p, "w"), indent=2)
    print("  removed openai-dev provider")
else:
    print("  openai-dev not registered (already removed)")
PY

say "2/4 pause inference-dev"
api POST "/projects/$PROJECT/services/$DEV_SVC/pause" '{}' >/dev/null || echo "  (already paused or doesn't exist)"

say "3/4 maybe pause weights-server (only if prod is also paused)"
PROD_PAUSED=$(api GET "/projects/$PROJECT/services/$PROD_SVC" | python3 -c "import json,sys; print(json.load(sys.stdin)['data'].get('servicePaused'))" 2>/dev/null || echo "True")
if [ "$PROD_PAUSED" = "True" ]; then
  api POST "/projects/$PROJECT/services/$WSVR/pause" '{}' >/dev/null || true
  echo "  prod paused too; weights-server paused"
else
  echo "  prod is up; leaving weights-server running"
fi

say "4/4 strip DEV_* env vars + restart local gateway"
sed -i '/^DEV_INFERENCE_URL=/d; /^DEV_MODEL_ID=/d' "$ENV_FILE"
systemctl --user restart openclaw-gateway.service
sleep 3

say "DONE — dev box paused, dev model unregistered"
echo "  Standby cost: ~\$0/hr (volume already counted in prod standby)"
echo "  Bring it back: $ROOT/infra/scripts/dev-up.sh"
