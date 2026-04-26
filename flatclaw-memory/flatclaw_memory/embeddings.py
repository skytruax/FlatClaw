"""Embedding backends for FlatClaw Memory.

Two modes:
- Default: Chroma's bundled ONNX embedder (all-MiniLM-L6-v2). No external service.
  Used for local dev + benchmarks. ~80 MB download on first use.
- Production: OpenAI-compatible HTTP endpoint (bge-m3 served by SGLang on the GPU VM).
  Selected when ``FLATCLAW_EMBEDDING_URL`` is set.
"""
from __future__ import annotations

import os
from typing import Optional

import httpx
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings


class HttpOpenAIEmbedder(EmbeddingFunction[Documents]):
    """OpenAI-compatible /v1/embeddings client — used against bge-m3 on the GPU VM."""

    def __init__(self, url: str, model: str = "bge-m3", timeout: float = 30.0) -> None:
        self.url = url.rstrip("/")
        self.model = model
        self._client = httpx.Client(timeout=timeout)

    def __call__(self, input: Documents) -> Embeddings:
        resp = self._client.post(
            f"{self.url}/v1/embeddings",
            json={"model": self.model, "input": list(input)},
        )
        resp.raise_for_status()
        data = resp.json()
        return [item["embedding"] for item in data["data"]]


def default_embedder() -> Optional[EmbeddingFunction]:
    """Pick an embedder based on env. None → Chroma's bundled ONNX default."""
    url = os.getenv("FLATCLAW_EMBEDDING_URL")
    if url:
        model = os.getenv("FLATCLAW_EMBEDDING_MODEL", "bge-m3")
        return HttpOpenAIEmbedder(url, model=model)
    return None
