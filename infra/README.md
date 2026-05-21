# infra/

Per-tenant infrastructure: the inference service image and the orchestration scripts that stand up a complete FlatClaw tenant.

## Architecture

A FlatClaw tenant owns one **Northflank project** holding the entire stack:

- Portal (Next.js)
- OpenClaw Gateway (agent runtime + per-agent memory)
- RAGFlow + corpus volume
- Inference service (Northflank-managed H100, 80 GB, sm_90, native FP8)
- weights-server (small CPU pod serving the model-weights volume to the inference pod over the project's internal network)

No second cloud, no BYOC plumbing, no GKE. Northflank schedules the GPU pod, manages ingress, TLS, DNS, observability, and project lifecycle.

## Layout

```
infra/
  inference/        # The GPU service
    Dockerfile
    entrypoint.sh
    README.md
  scripts/
    provision-tenant.sh   # End-to-end: Northflank project + volume + stager + deploy
    destroy-tenant.sh     # Tear down everything for a tenant
```

All four services plus the weights-server are deployed via Northflank manifests applied by `provision-tenant.sh`. The non-GPU services run on Northflank's standard compute plans inside the tenant's project.

## Tenant lifecycle

`provision-tenant.sh <tenant_id>` does, in order:

1. Create a Northflank project named after the tenant.
2. Provision the per-tenant weights volume (200 GB nvme).
3. Run a one-shot Northflank stager job that mounts the volume, installs the Kaggle CLI, downloads `google/gemma-4/transformers/gemma-4-31b-it`, extracts and lays it out under `gemma-4-31b-it/`. ~10–15 minutes, idempotent.
4. Deploy the weights-server pod (HTTP file server over the volume, internal-only).
5. Apply the Northflank manifests for Portal, Gateway, RAGFlow, and the inference service (H100 plan, custom entrypoint that fetches weights from weights-server at boot).
6. Seed RBAC: create the owner user, default role-policy matrix.
7. Print the Portal URL.

Target end-to-end runtime: under 20 minutes from zero to a working Portal URL.

`destroy-tenant.sh <tenant_id>` deletes the Northflank project (which cascades the application stack and the volume). One vendor relationship, one teardown command, no orphaned resources anywhere else.

## Verification

1. `provision-tenant.sh` produces a working tenant with TLS in ≤ 20 min, three runs in a row from zero.
2. `destroy-tenant.sh` leaves nothing — `northflank project list` is empty of the tenant id.
