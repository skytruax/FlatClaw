#!/usr/bin/env bash
# install-openclaw.sh — install the exact openclaw version FlatClaw is pinned to.
#
# The pin lives in portal/lib/openclaw/version-pin.ts (single source of truth).
# This script reads it, runs `npm i -g openclaw@<pin>` on the Node that is on
# PATH, and prints the resulting version for verification.
#
# Use this in:
#   - dev-up.sh / new-machine bootstrap
#   - CI gates that need the verified runtime
# (the control image has its own copy of these steps in infra/kirk/Dockerfile.control)
#
# Manual usage (idempotent):
#   ./infra/scripts/install-openclaw.sh
#
# This only installs the package. An OpenClaw that is newer than the state in
# ~/.openclaw refuses to start on it until that state is migrated — stop the
# gateway, back up ~/.openclaw, then `openclaw doctor --fix` (one-way: the
# older OpenClaw cannot read migrated state). The script prints this again when
# it changes the version.
#
# Bumping the pin: see the procedure at the top of version-pin.ts.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PIN_FILE="$ROOT/portal/lib/openclaw/version-pin.ts"

if [[ ! -f "$PIN_FILE" ]]; then
  echo "[install-openclaw] pin file missing: $PIN_FILE" >&2
  exit 1
fi

# Extract the pinned version with a single-line grep — no node/tsx needed
# so this works inside minimal container builds.
VERSION="$(grep -E 'OPENCLAW_VERIFIED_VERSION[[:space:]]*=' "$PIN_FILE" | sed -E 's/.*"([^"]+)".*/\1/')"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
  echo "[install-openclaw] failed to parse pin from $PIN_FILE (got: '$VERSION')" >&2
  exit 1
fi

echo "[install-openclaw] target: openclaw@$VERSION"

# The pinned OpenClaw's Node requirement (its package.json `engines`; mirrored
# in version-pin.ts as OPENCLAW_NODE_REQUIREMENT): >=24.16 <25, or >=26.1.
# npm's own preinstall check can be skipped by newer npm, so check here.
NODE_VERSION="$(node -p 'process.versions.node')"
if ! node -e '
  const [maj, min] = process.versions.node.split(".").map(Number);
  process.exit((maj === 24 && min >= 16) || (maj === 26 && min >= 1) || maj > 26 ? 0 : 1);
'; then
  echo "[install-openclaw] Node $NODE_VERSION is not supported by openclaw@$VERSION (needs >=24.16 <25, or >=26.1)." >&2
  echo "[install-openclaw] e.g.: nvm install 24 && nvm use 24, then re-run this script." >&2
  exit 1
fi

CURRENT="$(npm -g list openclaw 2>/dev/null | awk -F@ '/openclaw@/ {print $NF; exit}')"
if [[ "$CURRENT" == "$VERSION" ]]; then
  echo "[install-openclaw] already at pinned version, no-op"
  exit 0
fi

echo "[install-openclaw] currently installed: ${CURRENT:-<none>}"
# npm 12 blocks package lifecycle scripts unless they are allowed by name, and
# openclaw's are part of a working install. npm 11.16+ knows the flag; older
# npm rejects it.
NPM_FLAGS=()
if node -e '
  const [maj, min] = process.argv[1].split(".").map(Number);
  process.exit(maj > 11 || (maj === 11 && min >= 16) ? 0 : 1);
' "$(npm --version)"; then
  NPM_FLAGS+=(--allow-scripts=openclaw)
fi
npm i -g "openclaw@$VERSION" "${NPM_FLAGS[@]}"

INSTALLED="$(npm -g list openclaw 2>/dev/null | awk -F@ '/openclaw@/ {print $NF; exit}')"
echo "[install-openclaw] now at: $INSTALLED"

if [[ "$INSTALLED" != "$VERSION" ]]; then
  echo "[install-openclaw] WARNING: installed version ($INSTALLED) doesn't match pin ($VERSION)" >&2
  exit 2
fi

cat <<EOF
[install-openclaw] installed. Before starting the gateway on existing state:
  1. stop the gateway and back up ~/.openclaw (the next step is one-way)
  2. openclaw doctor --fix
  3. start the gateway, then from portal/:  npm run test:gateway
EOF
