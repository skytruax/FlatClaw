#!/usr/bin/env bash
# provision-tenant.sh — one-command tenant provisioning.
#
# Status: stub. Full implementation lands in v0.2 (see README → Roadmap).
#
# When complete this script will, given a tenant slug:
#
#   1. Create a Northflank project named for the tenant.
#   2. Provision a 200 GB nvme volume in that project (the weights volume).
#   3. Run a one-shot Northflank stager job that mounts the volume, installs
#      the Kaggle CLI, downloads `google/gemma-4/transformers/gemma-4-31b-it/1`,
#      extracts the tar, lays files out under `gemma-4-31b-it/` on the volume.
#   4. Deploy the weights-server pod (HTTP file server over the volume,
#      internal-only).
#   5. Apply Northflank manifests for Portal / OpenClaw Gateway / RAGFlow.
#   6. Apply the inference service manifest on a Northflank H100 GPU plan
#      with a customEntrypoint that fetches weights from weights-server at
#      boot.
#   7. Seed RBAC: create the owner user, write default role-policy matrix.
#   8. Print the Portal URL.
#
# Target: under 20 minutes end-to-end, three clean runs from zero in a row,
# zero manual steps. See plan §Verification.
#
# v0.1.0 status: the staging recipe in step 3 has been verified manually
# (see the dev-up.sh + prod-up.sh scripts for the working Northflank API
# patterns); the full one-command orchestration is the v0.2 deliverable.

set -euo pipefail

cat >&2 <<'EOF'
provision-tenant.sh: not yet implemented in v0.1.0.

This is a stub. The full orchestration (Northflank project + weights
volume + stager job + service manifests + RBAC seed) lands in v0.2.

See README → Roadmap for the v0.2 scope and timeline.

For now, the manual recipe is documented in:
  - infra/inference/README.md   (image + weights-volume pattern)
  - infra/README.md             (architecture overview)
  - infra/scripts/dev-up.sh     (working Northflank API examples)
EOF
exit 2
