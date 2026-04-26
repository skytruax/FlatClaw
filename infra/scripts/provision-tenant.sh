#!/usr/bin/env bash
# provision-tenant.sh — one-command tenant provisioning.
#
# Status: stub. Full implementation lands in v0.2 (see README → Roadmap).
#
# When complete this script will, given a tenant slug:
#
#   1. Create a Northflank project named for the tenant.
#   2. Attach the customer's GCP BYOC cluster (Northflank → Cloud →
#      Provider links → Google Cloud Platform).
#   3. Provision a 200 GB pd-balanced disk in the BYOC cluster's zone.
#   4. Spin up a temp e2-standard-4 instance, attach the disk, run the
#      Kaggle CLI to download `google/gemma-4/transformers/gemma-4-31b-it/1`,
#      extract the tar, move files into `/mnt/models/models/gemma-4-31B-it/`,
#      then delete the temp instance.
#   5. Apply Northflank manifests for Console / Gateway / RAGFlow / Memory.
#   6. Apply the inference service manifest pinned to the GPU node + disk.
#   7. Seed RBAC: create the owner user, write default role-policy matrix.
#   8. Print the Console URL.
#
# Target: under 20 minutes end-to-end, three clean runs from zero in a row,
# zero manual steps. See plan §Verification.
#
# v0.1.0 status: the disk-staging recipe in step 4 has been verified
# manually; the orchestration glue is the v0.2 deliverable.

set -euo pipefail

cat >&2 <<'EOF'
provision-tenant.sh: not yet implemented in v0.1.0.

This is a stub. The full orchestration (Northflank project + GCP BYOC
attach + per-tenant disk + Kaggle weight stage + service manifests +
RBAC seed) lands in v0.2.

See README → Roadmap for the v0.2 scope and timeline.

For now, the manual recipe is documented in:
  - infra/inference/README.md  (image + per-tenant disk pattern)
  - infra/README.md            (architecture overview)
EOF
exit 2
