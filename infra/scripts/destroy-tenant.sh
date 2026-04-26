#!/usr/bin/env bash
# destroy-tenant.sh — clean tenant teardown.
#
# Status: stub. Full implementation lands in v0.2 (see README → Roadmap).
#
# When complete this script will:
#
#   1. Wipe FlatClaw Memory state for the tenant (DELETE /tenant/<id>).
#   2. Wipe RAGFlow corpus + namespace.
#   3. Delete the GCP persistent disk holding the tenant's model weights.
#   4. Delete the GCP GKE node pool.
#   5. Delete the Northflank project (cascades the application-stack
#      services, secrets, and volumes).
#
# Target: zero orphaned resources. `gcloud compute instances list`,
# `gcloud compute disks list`, and `northflank project list` should all be
# empty of the tenant id. No forgotten static IPs or leftover secret
# versions. See plan §Verification.

set -euo pipefail

cat >&2 <<'EOF'
destroy-tenant.sh: not yet implemented in v0.1.0.

This is a stub. The full teardown (memory + RAGFlow wipe + GCP disk +
GKE node pool + Northflank project delete) lands in v0.2.

See README → Roadmap for the v0.2 scope.
EOF
exit 2
