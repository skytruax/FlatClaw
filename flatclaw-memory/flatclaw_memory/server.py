"""FlatClaw Memory — FastAPI surface over the method-of-loci store."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .embeddings import default_embedder
from .store import DEFAULT_WING, Fact, MemoryStore


def _store_from_env() -> MemoryStore:
    sqlite_path = Path(os.getenv("FLATCLAW_MEMORY_SQLITE", "./data/memory.db"))
    chroma_path = Path(os.getenv("FLATCLAW_MEMORY_CHROMA", "./data/chroma"))
    return MemoryStore(
        sqlite_path=sqlite_path,
        chroma_path=chroma_path,
        embedding_function=default_embedder(),
    )


store = _store_from_env()
app = FastAPI(title="FlatClaw Memory", version="0.1.0")


class FactOut(BaseModel):
    id: str
    hall: str
    room: str
    content: str
    salience: float = Field(ge=0, le=1)
    written_at: str
    visible: bool = True
    distance: Optional[float] = None


def _fact_to_out(fact: Fact) -> FactOut:
    return FactOut(
        id=fact.id, hall=fact.hall, room=fact.room, content=fact.content,
        salience=fact.salience, written_at=fact.written_at,
        visible=fact.visible, distance=fact.distance,
    )


class RecallRequest(BaseModel):
    tenant_id: str
    query: str
    deep: bool = False
    max_tokens: int = 170


class RecallResponse(BaseModel):
    facts: list[FactOut]
    layer: Literal["L0+L1", "deep"]


class WriteRequest(BaseModel):
    tenant_id: str
    hall: str
    room: str
    content: str
    salience: float = 0.5
    wing: str = DEFAULT_WING


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/recall", response_model=RecallResponse)
def recall(req: RecallRequest) -> RecallResponse:
    facts, layer = store.recall(
        tenant_id=req.tenant_id,
        query=req.query,
        deep=req.deep,
        max_tokens=req.max_tokens,
    )
    return RecallResponse(facts=[_fact_to_out(f) for f in facts], layer=layer)


@app.post("/write", response_model=FactOut)
def write(req: WriteRequest) -> FactOut:
    fact = store.write(
        tenant_id=req.tenant_id,
        hall=req.hall,
        room=req.room,
        content=req.content,
        salience=req.salience,
        wing=req.wing,
    )
    return _fact_to_out(fact)


@app.get("/facts", response_model=list[FactOut])
def list_facts(tenant_id: str, hall: Optional[str] = None,
               limit: int = 500) -> list[FactOut]:
    return [_fact_to_out(f) for f in store.list_facts(tenant_id, hall, limit)]


@app.delete("/facts/{fact_id}")
def delete_fact(fact_id: str) -> dict:
    if not store.delete_fact(fact_id):
        raise HTTPException(status_code=404, detail="fact not found")
    return {"deleted": fact_id}


@app.delete("/halls/{hall}")
def delete_hall(hall: str, tenant_id: str) -> dict:
    removed = store.delete_hall(tenant_id, hall)
    return {"deleted_hall": hall, "facts_removed": removed}


@app.delete("/tenant/{tenant_id}")
def delete_tenant(tenant_id: str) -> dict:
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id required")
    removed = store.delete_tenant(tenant_id)
    return {"wiped": tenant_id, "facts_removed": removed}
