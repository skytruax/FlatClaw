#!/usr/bin/env bash
# install-openclaw.sh — install the exact openclaw version FlatClaw is pinned to.
#
# The pin lives in portal/lib/openclaw/version-pin.ts (single source of truth).
# This script reads it, runs `npm i -g openclaw@<pin>`, and prints the
# resulting version for verification.
#
# Use this in:
#   - Dockerfiles for the deployed gateway image
#   - dev-up.sh / new-machine bootstrap
#   - CI gates that need the verified runtime
#
# Manual usage (idempotent):
#   ./infra/scripts/install-openclaw.sh
#
# Bumping the pin: edit version-pin.ts, re-run this script, re-test.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PIN_FILE="$ROOT/portal/lib/openclaw/version-pin.ts"

if [[ ! -f "$PIN_FILE" ]]; then
  echo "[install-openclaw] pin file missing: $PIN_FILE" >&2
  exit 1
fi

# Extract the pinned version with a single-line grep — no node/tsx needed
# so this works inside minimal container builds.
VERSION="$(grep -E 'OPENCLAW_VERIFIED_VERSION\s*=' "$PIN_FILE" | sed -E 's/.*"([^"]+)".*/\1/')"

if [[ -z "$VERSION" ]]; then
  echo "[install-openclaw] failed to parse pin from $PIN_FILE" >&2
  exit 1
fi

echo "[install-openclaw] target: openclaw@$VERSION"

CURRENT="$(npm -g list openclaw 2>/dev/null | awk -F@ '/openclaw@/ {print $NF; exit}')"
if [[ "$CURRENT" == "$VERSION" ]]; then
  echo "[install-openclaw] already at pinned version, no-op"
  exit 0
fi

echo "[install-openclaw] currently installed: ${CURRENT:-<none>}"
npm i -g "openclaw@$VERSION"

INSTALLED="$(npm -g list openclaw 2>/dev/null | awk -F@ '/openclaw@/ {print $NF; exit}')"
echo "[install-openclaw] now at: $INSTALLED"

if [[ "$INSTALLED" != "$VERSION" ]]; then
  echo "[install-openclaw] WARNING: installed version ($INSTALLED) doesn't match pin ($VERSION)" >&2
  exit 2
fi
