# flatclaw-memory

Custom method-of-loci memory layer. **No MemPalace SDK dependency** — the pattern is public, the code is ours.

## Status

Spike D gate: **PASS**. p50 recall = 12.6ms at 10k facts (seeded + recalled + tenant-wiped), against a 200ms budget. Reproduce: `uv run python -m flatclaw_memory.benchmark`.

## Storage

- **ChromaDB** for vector index (per-tenant collection `flatclaw_{tenant_id}`).
- **SQLite** for the method-of-loci schema: `wings` → `halls` → `rooms` → `memory_facts`.

## API

FastAPI, mounted into OpenClaw as a skill:

| Endpoint | Purpose |
|---|---|
| `POST /recall` | `memory-recall(query)` — layered L0+L1 recent/high-salience fetch (~170 tokens default) with `deep=true` for full fan-out |
| `POST /write` | `memory-write(fact)` — background-extracted facts routed into the right hall/room |
| `GET /facts` | List + filter for the Console `/memory` privacy panel |
| `DELETE /facts/{id}` | Per-fact delete (Console privacy panel) |
| `DELETE /halls/{hall}` | Per-hall wipe |
| `DELETE /tenant/{id}` | Full tenant wipe for destroy-tenant.sh |

## Spike D gate

- `<200ms` p50 recall at 10k facts — **PASS** (p50≈12.6ms, p99≈17ms)
- Clean per-tenant delete semantics — **PASS** (list→0 after `delete_tenant`)
- Schema portable between SQLite and any relational DB we swap to — yes

The benchmark supplies precomputed 1024-dim vectors via the store's `embedding` / `query_embedding` paths, matching bge-m3 dimensionality. This measures store latency (HNSW + SQLite hydrate + layered filter), which is what the gate targets — embedder latency is covered separately in Spike B.

## Dev

```bash
uv sync
# one-shot bench
uv run python -m flatclaw_memory.benchmark
# long-running server
uv run uvicorn flatclaw_memory.server:app --reload --port 8790
```

## Embedder

Default: Chroma's bundled ONNX `all-MiniLM-L6-v2` (self-contained, CPU-only, ~80 MB first-use download).
Production: set `FLATCLAW_EMBEDDING_URL` to the inference service's public Northflank URL — the service calls bge-m3 via OpenAI-compatible `/v1/embeddings`. bge-m3 runs co-resident with Gemma 4 31B on the same RTX PRO 6000 Blackwell.
