"""Spike D gate — seed 10k facts, measure recall p50, verify per-tenant wipe.

The Spike D gate (``p50 recall < 200ms at 10k facts``) targets store latency:
HNSW ANN query + SQLite hydrate + layered-load filter. Embedding cost is out
of scope here — in production the embedder is bge-m3 on the GPU (≈10–20ms per
query, measured in Spike B). For a self-contained benchmark we supply
deterministic 1024-dim vectors directly via the store's ``embedding`` /
``query_embedding`` paths, matching the bge-m3 dimensionality.

Run:
    uv run python -m flatclaw_memory.benchmark
"""
from __future__ import annotations

import argparse
import hashlib
import random
import shutil
import statistics
import sys
import time
from pathlib import Path

from .store import MemoryStore

TENANT = "00000000-0000-0000-0000-00000000bench"
EMBED_DIM = 1024  # bge-m3 output dimensionality

SUBJECTS = ["Alice", "Bob", "Carol", "Dave", "Eve", "Mallory", "Trent",
            "Ivy", "Judy", "Kim", "Leo", "Moe", "Nia", "Omar"]
VERBS = ["emailed", "called", "wrote to", "met with", "scheduled a call with",
         "reviewed a contract from", "invoiced", "followed up with"]
TOPICS = ["the Q2 forecast", "the merger document", "the HR policy draft",
          "the tax filing checklist", "the onboarding SOP", "the client SLA",
          "the incident post-mortem", "the board meeting agenda",
          "the employee handbook", "the vendor renewal"]


def gen_content(i: int, rng: random.Random) -> str:
    s = SUBJECTS[i % len(SUBJECTS)]
    v = VERBS[(i // len(SUBJECTS)) % len(VERBS)]
    t = TOPICS[(i // (len(SUBJECTS) * len(VERBS))) % len(TOPICS)]
    return f"{s} {v} {t} — fact #{i}, ref:{rng.randint(0, 10_000_000)}"


def fake_embedding(text: str, dim: int = EMBED_DIM) -> list[float]:
    """Deterministic pseudo-vector derived from a SHA-256 stream.

    Not semantically meaningful — Spike D measures store latency, not recall
    quality. Spike B measures real-embedder latency; recall quality is
    covered by end-to-end tests in Milestone 2.
    """
    seed = int.from_bytes(hashlib.sha256(text.encode()).digest()[:8], "big")
    rng = random.Random(seed)
    return [rng.gauss(0.0, 1.0) for _ in range(dim)]


def bench(n: int = 10_000, runs: int = 200, seed: int = 42,
          cleanup: bool = True, root: Path = Path("./.bench-memory")) -> bool:
    rng = random.Random(seed)
    if root.exists():
        shutil.rmtree(root)
    store = MemoryStore(sqlite_path=root / "mem.db", chroma_path=root / "chroma")

    print(f"[seed] writing {n:,} facts with precomputed {EMBED_DIM}-dim vectors")
    t0 = time.perf_counter()
    for i in range(n):
        content = gen_content(i, rng)
        store.write(
            tenant_id=TENANT,
            hall=f"hall_{i // 500}",
            room=f"room_{(i // 50) % 10}",
            content=content,
            salience=rng.random(),
            embedding=fake_embedding(content),
        )
    t_seed = time.perf_counter() - t0
    print(f"[seed] done in {t_seed:.1f}s  ({n / t_seed:.0f} facts/s)")

    print(f"[recall] {runs} queries, deep=False, precomputed query vectors")
    latencies_ms: list[float] = []
    query_texts = [gen_content(rng.randrange(n), rng) for _ in range(runs)]
    query_vectors = [fake_embedding(q) for q in query_texts]
    for q_text, q_vec in zip(query_texts, query_vectors):
        t0 = time.perf_counter()
        store.recall(tenant_id=TENANT, query=q_text, deep=False,
                     query_embedding=q_vec)
        latencies_ms.append((time.perf_counter() - t0) * 1000)
    p50 = statistics.median(latencies_ms)
    p95 = statistics.quantiles(latencies_ms, n=20)[18]
    p99 = statistics.quantiles(latencies_ms, n=100)[98]
    print(f"[recall] p50={p50:.1f}ms  p95={p95:.1f}ms  p99={p99:.1f}ms  "
          f"max={max(latencies_ms):.1f}ms")

    print("[delete] per-tenant wipe")
    before = len(store.list_facts(TENANT, limit=n + 1))
    wiped = store.delete_tenant(TENANT)
    after = len(store.list_facts(TENANT, limit=n + 1))
    assert before == n, f"seeded {n} but list returned {before}"
    assert wiped == n, f"delete_tenant reported {wiped}, expected {n}"
    assert after == 0, f"list after wipe: {after}"
    print(f"[delete] wiped {wiped:,} facts  (list_facts after: {after})")

    store.close()
    if cleanup:
        shutil.rmtree(root)

    gate_ok = p50 < 200.0
    print()
    verdict = "PASS" if gate_ok else "FAIL"
    print(f"GATE: p50 < 200ms  —  {verdict}  (p50={p50:.1f}ms at n={n:,})")
    return gate_ok


def main() -> int:
    parser = argparse.ArgumentParser(description="Spike D memory benchmark")
    parser.add_argument("-n", "--facts", type=int, default=10_000)
    parser.add_argument("-r", "--runs", type=int, default=200)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--keep", action="store_true",
                        help="keep ./.bench-memory after run")
    args = parser.parse_args()
    ok = bench(n=args.facts, runs=args.runs, seed=args.seed, cleanup=not args.keep)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
