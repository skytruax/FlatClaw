# skills/

OpenClaw skills bundle. One directory per skill. Each skill is a self-contained package the agent can call.

| Skill | Purpose | `requires_review` |
|---|---|---|
| `gmail` | Read / draft / send mail | `send` only |
| `gdrive` | Read / write / delete Drive files | `write`, `delete` |
| `scrapling` | Private-internet fetch (respecting robots) | no |
| `voxcpm2` | Voice clone + TTS via GPU worker | no |
| `sdxl` | Image generation via ComfyUI on GPU worker | no |
| `rag-search` | Thin wrapper over RAGFlow's retrieval API | no |
| `memory-recall` | Thin wrapper over flatclaw-memory `/recall` | no |
| `memory-write` | Thin wrapper over flatclaw-memory `/write` | no |
| `fs-paths` | Whitelisted filesystem read/write/delete | `delete` |

Destructive tool calls flagged `requires_review` are gated by OpenClaw at the tool-invocation point. OpenClaw pauses the tool call and emits an approval event over the Console WebSocket; the Console approvals UI surfaces it as a card. On approve/reject, the gate resumes or cancels the tool call.

Each skill folder contains:

```
<skill>/
  skill.yaml       # name, description, JSON schema for inputs, requires_review flags
  handler.ts|.py   # implementation
  README.md        # operator notes
```
