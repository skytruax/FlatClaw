# infra/

Per-tenant infrastructure: the inference service image and the orchestration scripts that stand up a complete FlatClaw tenant.

## Architecture

A FlatClaw tenant owns:
- One **Northflank project** holding the application stack (Console, OpenClaw Gateway, RAGFlow, FlatClaw Memory).
- One **GCP project** holding the GPU instance (`g4-standard-12` with 1× NVIDIA RTX PRO 6000 Blackwell) and the model-weights disk.

Northflank's BYOC integration wires the two together: it manages a GKE cluster inside the tenant's GCP project, and one of the Northflank services in the tenant project is pinned to that cluster's GPU node.

## Layout

```
infra/
  inference/        # The GPU service
    Dockerfile
    entrypoint.sh
    README.md
  scripts/
    provision-tenant.sh   # End-to-end: Northflank project + GCP disk + weight stage + BYOC + deploy
    destroy-tenant.sh     # Tear down everything for a tenant
```

The Console / OpenClaw Gateway / RAGFlow / FlatClaw Memory services are deployed via Northflank manifests applied by `provision-tenant.sh`. They are Northflank-native (no GPU, no GCP) and run on Northflank's standard compute pool inside the tenant's project.

## Tenant lifecycle

`provision-tenant.sh <tenant_id>` does, in order:

1. Create a Northflank project named after the tenant.
2. Attach the customer's GCP BYOC cluster to that project.
3. Create a 200 GB `pd-balanced` disk in the GCP zone where g4-standard-* lives (us-central1-b by default).
4. Spin up a temporary `e2-standard-4` instance, attach the disk, run the Kaggle CLI to download Gemma 4 31B + bge-m3, move files into `/workspace/models/<modelname>/`, then delete the temp instance.
5. Apply the Northflank manifests for Console, Gateway, RAGFlow, Memory, and the inference service (the last one pinned to the GPU node + disk).
6. Seed RBAC: create the owner user, default role-policy matrix.
7. Print the Console URL.

Target end-to-end runtime: under 20 minutes once GCP GPU quota is approved on the customer's project.

`destroy-tenant.sh <tenant_id>` deletes the Northflank project (cascades the application stack), then deletes the GCP disk and the GKE node pool. No orphaned resources.

## Verification

1. `provision-tenant.sh` produces a working tenant with TLS in ≤ 20 min, three runs in a row from zero.
2. `destroy-tenant.sh` leaves nothing — `gcloud compute instances list` and `northflank project list` are both empty of the tenant id.
