# ragflow-config

Per-tenant RAGFlow configuration. RAGFlow is FlatClaw's primary document-ingest and retrieval engine, deployed as a Northflank service inside each tenant's project.

## What lives here

- `northflank.yaml` — Northflank service manifest for RAGFlow (small CPU plan + persistent volume for the corpus).
- `namespace-template.yaml` — per-tenant namespace spec (knowledge base name, embedding model, chunking policy, citation mode).
- `destroy-hook.sh` — called by `destroy-tenant.sh` to wipe the tenant's RAGFlow corpus volume before the project is deleted.

## How it fits

RAGFlow points its embedder at the **inference service's** `/v1/embeddings` endpoint (bge-m3 co-resident on the GPU). It exposes its retrieval API as the OpenClaw skill `rag-search` — agents call `rag-search(query, namespace)` and get cited answers.

The Console's Docs panel surfaces the RAGFlow corpus directly: drag a folder in, watch ingest progress, get citations in chat.

## Supported formats

PDF, Docx, Excel, PPT, markdown, plain text, `.eml`, scanned images (OCR), webpages. Audio/video transcription lands in v2.

## Swap plan

RAGFlow is wrapped behind the `rag-search` skill's stable interface. If RAGFlow becomes a maintenance burden we can swap in R2R or a minimal LlamaIndex-based replacement without touching the agent or the Console.
