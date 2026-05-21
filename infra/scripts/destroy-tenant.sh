#!/usr/bin/env bash
# destroy-tenant.sh — clean tenant teardown.
#
# Status: stub. Full implementation lands in v0.2 (see README → Roadmap).
#
# When complete this script will:
#
#   1. Wipe RAGFlow corpus + namespace.
#   2. Delete the Northflank project (cascades every service, the weights
#      volume, the corpus volume, all secrets, the public URLs).
#
# Per-agent memory is owned by OpenClaw and lives inside each agent's
# workspace under the gateway service — deleting the Northflank project
# cascades it automatically. No separate memory wipe.
#
# Target: zero orphaned resources. `northflank project list` should be
# empty of the tenant id. No forgotten secrets, volumes, or DNS records.
# See plan §Verification.

set -euo pipefail

cat >&2 <<'EOF'
destroy-tenant.sh: not yet implemented in v0.1.0.

This is a stub. The full teardown (RAGFlow wipe + Northflank project
delete) lands in v0.2.

See README → Roadmap for the v0.2 scope.
EOF
exit 2
