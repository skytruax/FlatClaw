# FlatClaw Console

Private-cloud AI coworker UI. Chat, agent fleet, approvals, cron, skills, RAG-backed documents, and a privacy-first memory panel — all in one dashboard.

Connects to an OpenClaw gateway over a server-owned WebSocket. Streams tool-use events to the browser via SSE. Ships as part of [FlatClaw](../README.md), which provisions the full stack (inference + gateway + console + memory + RAGFlow) as a Northflank project.

## Stack

Next.js 16 · React 19 · TypeScript · better-sqlite3 · Tailwind · Playwright · Vitest.

## Dev

Requirements: Node 20.9+.

```bash
npm install
npm run dev
```

Point at an OpenClaw gateway via Settings (UI) or `NEXT_PUBLIC_GATEWAY_URL` in `.env.local`.

## License

MIT. See [LICENSE](LICENSE).
