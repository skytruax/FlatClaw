"""Method-of-loci memory store — SQLite for structure, Chroma for vectors.

Layout:
    wings   (tenant-scoped top-level partition)
      └─ halls   (broad topic — "Acme account", "Q2 close")
          └─ rooms   (specific context within a hall)
              └─ memory_facts   (salience-weighted entries + Chroma pointer)

One Chroma collection per tenant (``flatclaw_<tenant_id>``). SQLite stores
structure and metadata; Chroma stores embeddings only. Per-tenant delete drops
both sides.
"""
from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from uuid import uuid4

import chromadb
from chromadb.api.types import EmbeddingFunction

SCHEMA_PATH = Path(__file__).parent / "schema.sql"

L1_SALIENCE_THRESHOLD = 0.7
L0_RECENCY_WINDOW = timedelta(days=1)
DEFAULT_WING = "default"


@dataclass
class Fact:
    id: str
    hall: str
    room: str
    content: str
    salience: float
    written_at: str
    visible: bool = True
    distance: Optional[float] = None


def _collection_name(tenant_id: str) -> str:
    # Chroma collection names must match [a-zA-Z0-9._-]{3,63}; UUIDs already qualify.
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in tenant_id)
    return f"flatclaw_{safe}"


def _is_recent(iso_ts: str, window: timedelta = L0_RECENCY_WINDOW) -> bool:
    ts = datetime.fromisoformat(iso_ts)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - ts) <= window


class MemoryStore:
    def __init__(
        self,
        sqlite_path: Path,
        chroma_path: Path,
        embedding_function: Optional[EmbeddingFunction] = None,
    ) -> None:
        self._lock = threading.RLock()
        self._sqlite_path = Path(sqlite_path)
        self._chroma_path = Path(chroma_path)
        self._ef = embedding_function

        self._sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        self._chroma_path.mkdir(parents=True, exist_ok=True)

        self._db = sqlite3.connect(self._sqlite_path, check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA foreign_keys=ON")
        self._db.executescript(SCHEMA_PATH.read_text())

        self._chroma = chromadb.PersistentClient(path=str(self._chroma_path))

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # ---------- structure ----------

    def _collection(self, tenant_id: str):
        kwargs = {"name": _collection_name(tenant_id)}
        if self._ef is not None:
            kwargs["embedding_function"] = self._ef
        return self._chroma.get_or_create_collection(**kwargs)

    def _ensure_row(self, cur: sqlite3.Cursor, table: str, keys: tuple[str, ...],
                    values: tuple) -> str:
        where = " AND ".join(f"{k}=?" for k in keys)
        row = cur.execute(
            f"SELECT id FROM {table} WHERE {where} LIMIT 1", values
        ).fetchone()
        if row:
            return row[0]
        new_id = str(uuid4())
        cols = ("id",) + keys
        placeholders = ",".join("?" for _ in cols)
        cur.execute(
            f"INSERT INTO {table} ({','.join(cols)}) VALUES ({placeholders})",
            (new_id, *values),
        )
        return new_id

    def _ensure_location(self, tenant_id: str, wing: str, hall: str, room: str) -> str:
        with self._lock:
            cur = self._db.cursor()
            wing_id = self._ensure_row(cur, "wings", ("tenant_id", "name"),
                                       (tenant_id, wing))
            hall_id = self._ensure_row(cur, "halls", ("wing_id", "name"),
                                       (wing_id, hall))
            room_id = self._ensure_row(cur, "rooms", ("hall_id", "name"),
                                       (hall_id, room))
            self._db.commit()
            return room_id

    # ---------- write ----------

    def write(
        self,
        tenant_id: str,
        hall: str,
        room: str,
        content: str,
        salience: float = 0.5,
        wing: str = DEFAULT_WING,
        embedding: Optional[list[float]] = None,
    ) -> Fact:
        """Persist a fact. If ``embedding`` is provided it's used directly;
        otherwise Chroma's embedding function is invoked against ``content``."""
        salience = max(0.0, min(1.0, salience))
        room_id = self._ensure_location(tenant_id, wing, hall, room)
        fact_id = str(uuid4())
        written_at = datetime.now(timezone.utc).isoformat()

        with self._lock:
            self._db.execute(
                """INSERT INTO memory_facts
                     (id, tenant_id, room_id, content, salience, embedding_ref,
                      written_at, visible)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 1)""",
                (fact_id, tenant_id, room_id, content, salience, fact_id, written_at),
            )
            self._db.commit()

        metadata = {
            "tenant_id": tenant_id,
            "hall": hall,
            "room": room,
            "salience": salience,
            "written_at": written_at,
        }
        upsert_kwargs: dict = {
            "ids": [fact_id],
            "documents": [content],
            "metadatas": [metadata],
        }
        if embedding is not None:
            upsert_kwargs["embeddings"] = [embedding]
        self._collection(tenant_id).upsert(**upsert_kwargs)
        return Fact(
            id=fact_id, hall=hall, room=room, content=content,
            salience=salience, written_at=written_at, visible=True,
        )

    # ---------- recall ----------

    def recall(
        self,
        tenant_id: str,
        query: str,
        deep: bool = False,
        max_tokens: int = 170,
        k: int = 30,
        query_embedding: Optional[list[float]] = None,
    ) -> tuple[list[Fact], str]:
        """Layered recall. If ``query_embedding`` is provided it's used directly;
        otherwise Chroma's embedding function runs against ``query``."""
        collection = self._collection(tenant_id)
        if collection.count() == 0:
            return [], "deep" if deep else "L0+L1"

        n_results = min(k, collection.count())
        if query_embedding is not None:
            results = collection.query(
                query_embeddings=[query_embedding], n_results=n_results
            )
        else:
            results = collection.query(query_texts=[query], n_results=n_results)
        ids = results.get("ids", [[]])[0]
        distances = results.get("distances", [[]])[0]
        if not ids:
            return [], "deep" if deep else "L0+L1"

        placeholders = ",".join("?" for _ in ids)
        rows = self._db.execute(
            f"""SELECT mf.id, h.name, r.name, mf.content, mf.salience,
                       mf.written_at, mf.visible
                  FROM memory_facts mf
                  JOIN rooms r ON r.id = mf.room_id
                  JOIN halls h ON h.id = r.hall_id
                 WHERE mf.id IN ({placeholders}) AND mf.tenant_id = ?""",
            (*ids, tenant_id),
        ).fetchall()
        by_id = {row[0]: row for row in rows}

        facts: list[Fact] = []
        for fid, dist in zip(ids, distances):
            row = by_id.get(fid)
            if row is None or not row[6]:
                continue
            facts.append(Fact(
                id=row[0], hall=row[1], room=row[2], content=row[3],
                salience=row[4], written_at=row[5], visible=bool(row[6]),
                distance=float(dist) if dist is not None else None,
            ))

        if not deep:
            layered = [
                f for f in facts
                if f.salience >= L1_SALIENCE_THRESHOLD or _is_recent(f.written_at)
            ]
            if len(layered) >= 3:
                facts = layered

        out: list[Fact] = []
        budget = max_tokens * 4  # ~4 chars per token is the conventional estimate
        for fact in facts:
            if budget <= 0 and out:
                break
            out.append(fact)
            budget -= len(fact.content)
        return out, "deep" if deep else "L0+L1"

    # ---------- list / delete ----------

    def list_facts(self, tenant_id: str, hall: Optional[str] = None,
                   limit: int = 500) -> list[Fact]:
        query = (
            "SELECT mf.id, h.name, r.name, mf.content, mf.salience, "
            "       mf.written_at, mf.visible "
            "  FROM memory_facts mf "
            "  JOIN rooms r ON r.id = mf.room_id "
            "  JOIN halls h ON h.id = r.hall_id "
            " WHERE mf.tenant_id = ?"
        )
        args: list = [tenant_id]
        if hall is not None:
            query += " AND h.name = ?"
            args.append(hall)
        query += " ORDER BY mf.written_at DESC LIMIT ?"
        args.append(limit)
        rows = self._db.execute(query, args).fetchall()
        return [
            Fact(id=r[0], hall=r[1], room=r[2], content=r[3],
                 salience=r[4], written_at=r[5], visible=bool(r[6]))
            for r in rows
        ]

    def delete_fact(self, fact_id: str) -> bool:
        with self._lock:
            row = self._db.execute(
                "SELECT tenant_id FROM memory_facts WHERE id = ?", (fact_id,)
            ).fetchone()
            if row is None:
                return False
            tenant_id = row[0]
            self._db.execute("DELETE FROM memory_facts WHERE id = ?", (fact_id,))
            self._db.commit()
        # Chroma's delete(ids=...) is idempotent — no exception on missing id.
        self._collection(tenant_id).delete(ids=[fact_id])
        return True

    def delete_hall(self, tenant_id: str, hall: str) -> int:
        with self._lock:
            rows = self._db.execute(
                """SELECT mf.id
                     FROM memory_facts mf
                     JOIN rooms r ON r.id = mf.room_id
                     JOIN halls h ON h.id = r.hall_id
                    WHERE mf.tenant_id = ? AND h.name = ?""",
                (tenant_id, hall),
            ).fetchall()
            ids = [r[0] for r in rows]
            if ids:
                placeholders = ",".join("?" for _ in ids)
                self._db.execute(
                    f"DELETE FROM memory_facts WHERE id IN ({placeholders})", ids
                )
            self._db.execute(
                """DELETE FROM halls
                    WHERE name = ? AND wing_id IN
                        (SELECT id FROM wings WHERE tenant_id = ?)""",
                (hall, tenant_id),
            )
            self._db.commit()
        if ids:
            self._collection(tenant_id).delete(ids=ids)
        return len(ids)

    def delete_tenant(self, tenant_id: str) -> int:
        with self._lock:
            count = self._db.execute(
                "SELECT COUNT(*) FROM memory_facts WHERE tenant_id = ?",
                (tenant_id,),
            ).fetchone()[0]
            self._db.execute(
                "DELETE FROM memory_facts WHERE tenant_id = ?", (tenant_id,)
            )
            self._db.execute(
                """DELETE FROM rooms WHERE hall_id IN
                       (SELECT h.id FROM halls h
                          JOIN wings w ON w.id = h.wing_id
                         WHERE w.tenant_id = ?)""",
                (tenant_id,),
            )
            self._db.execute(
                """DELETE FROM halls WHERE wing_id IN
                       (SELECT id FROM wings WHERE tenant_id = ?)""",
                (tenant_id,),
            )
            self._db.execute(
                "DELETE FROM wings WHERE tenant_id = ?", (tenant_id,)
            )
            self._db.commit()

        target = _collection_name(tenant_id)
        existing = {
            c.name if hasattr(c, "name") else str(c)
            for c in self._chroma.list_collections()
        }
        if target in existing:
            self._chroma.delete_collection(target)
        return count
