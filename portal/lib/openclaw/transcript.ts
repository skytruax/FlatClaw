/**
 * Translates openclaw's chat.history `messages` array into the chat panel's
 * bubble structure.
 *
 * Real openclaw transcript shapes (from JSONL inspection):
 *
 *   { role: "user", content: [{ type: "text", text: "..." }] }
 *
 *   { role: "assistant", content: [
 *       { type: "thinking", thinking: "...", thinkingSignature: "..." },
 *       { type: "text", text: "..." },
 *       { type: "toolCall", id: "<id>", name: "exec", arguments: {...} },
 *     ] }
 *
 *   { role: "toolResult",
 *     toolCallId: "<id>",
 *     toolName: "exec",
 *     isError: false,
 *     content: [{ type: "text", text: "<result>" }] }
 *
 * We collapse this into our bubble shape:
 *   - one bubble per user/assistant message
 *   - toolCall blocks become entries in `bubble.tools`
 *   - toolResult messages match back to the originating tool by `toolCallId`
 */

export interface TranscriptToolEvent {
  id: string;
  name: string;
  args?: unknown;
  status: "pending" | "done" | "failed";
  result?: string;
  error?: string;
}

export interface TranscriptBubble {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  reasoning?: string;
  tools: TranscriptToolEvent[];
  streaming: false;
  timestamp: number;
}

interface MessageBlock {
  type?: string;
  // text-block
  text?: string;
  // thinking-block
  thinking?: string;
  // toolCall-block (openclaw transcript shape)
  id?: string;
  name?: string;
  arguments?: unknown;
  // toolUse-block (anthropic-style alias seen in some projections)
  input?: unknown;
  // tool_result-block aliases
  tool_use_id?: string;
  toolUseId?: string;
  is_error?: boolean;
  isError?: boolean;
  content?: unknown;
}

interface RawMessage {
  id?: string;
  role?: string;
  // openclaw emits either a block array or, since 2026.5.27, a plain string.
  content?: string | MessageBlock[];
  // toolResult message-level fields
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  // timestamps (varies by source)
  timestamp?: number | string;
  createdAtMs?: number;
}

function asText(b: MessageBlock): string {
  if (typeof b.text === "string") return b.text;
  if (typeof b.thinking === "string") return b.thinking;
  return "";
}

function stringifyContent(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v == null) return undefined;
  if (Array.isArray(v)) {
    // tool_result-style content: array of {type:"text", text}
    return v
      .map((b) =>
        typeof b === "object" && b && "text" in b
          ? String((b as { text?: unknown }).text ?? "")
          : typeof b === "string"
            ? b
            : JSON.stringify(b),
      )
      .filter(Boolean)
      .join("\n");
  }
  return JSON.stringify(v, null, 2);
}

function tsMs(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Date.parse(v);
    return Number.isNaN(n) ? Date.now() : n;
  }
  return Date.now();
}

const TOOL_CALL_BLOCK_TYPES = new Set([
  "toolcall",
  "tool_call",
  "tooluse",
  "tool_use",
]);
const TOOL_RESULT_BLOCK_TYPES = new Set([
  "toolresult",
  "tool_result",
]);

function normalizeRole(role: unknown): string {
  return typeof role === "string" ? role.trim().toLowerCase() : "";
}
function normalizeType(t: unknown): string {
  return typeof t === "string" ? t.trim().toLowerCase() : "";
}

export function transcriptToBubbles(messages: RawMessage[]): TranscriptBubble[] {
  const bubbles: TranscriptBubble[] = [];
  // Index of toolCallId → bubble that owns it, so toolResult messages
  // (which arrive as separate transcript entries) can attach back.
  const toolOwner = new Map<string, { bubble: TranscriptBubble; idx: number }>();

  for (const msg of messages) {
    const role = normalizeRole(msg.role);
    const blocks = Array.isArray(msg.content) ? msg.content : [];

    if (role === "user") {
      // openclaw 2026.5.27 emits user messages with `content` as a plain
      // string (chat-send path; carries an `idempotencyKey`), while seeded /
      // older messages use the `[{type:"text"}]` block array. Handle both, or
      // every typed message gets dropped here and never renders.
      const text =
        typeof msg.content === "string"
          ? msg.content.trim()
          : blocks
              .filter((b) => normalizeType(b.type) === "text")
              .map(asText)
              .join("\n")
              .trim();
      if (!text) continue;
      bubbles.push({
        id: msg.id ?? crypto.randomUUID(),
        role: "user",
        text,
        tools: [],
        streaming: false,
        timestamp: tsMs(msg.timestamp ?? msg.createdAtMs),
      });
      continue;
    }

    if (role === "assistant") {
      const textParts: string[] = [];
      const reasoningParts: string[] = [];
      const tools: TranscriptToolEvent[] = [];
      // Same 2026.5.27 string-content shape can appear on plain assistant
      // replies (no tools/thinking); without this they'd be dropped as empty.
      if (typeof msg.content === "string") textParts.push(msg.content);
      for (const b of blocks) {
        const t = normalizeType(b.type);
        if (t === "text") textParts.push(asText(b));
        else if (t === "thinking" || t === "reasoning") reasoningParts.push(asText(b));
        else if (TOOL_CALL_BLOCK_TYPES.has(t)) {
          tools.push({
            id: b.id ?? crypto.randomUUID(),
            name: b.name ?? "tool",
            args: b.arguments ?? b.input,
            status: "pending",
          });
        }
      }
      const bubble: TranscriptBubble = {
        id: msg.id ?? crypto.randomUUID(),
        role: "assistant",
        text: textParts.join("\n").trim(),
        reasoning: reasoningParts.join("\n").trim() || undefined,
        tools,
        streaming: false,
        timestamp: tsMs(msg.timestamp ?? msg.createdAtMs),
      };
      // Skip totally empty assistant bubbles (no text, no tools, no reasoning)
      // — they'd render as ghost rows and that's exactly what was happening.
      if (!bubble.text && !bubble.reasoning && bubble.tools.length === 0) {
        continue;
      }
      const idx = bubbles.length;
      bubbles.push(bubble);
      for (const tool of tools) toolOwner.set(tool.id, { bubble, idx });
      continue;
    }

    // openclaw uses role:"toolResult" (camelCase) for tool result messages;
    // also accept tool/tool_result/function for compatibility.
    if (
      role === "toolresult" ||
      role === "tool_result" ||
      role === "tool" ||
      role === "function"
    ) {
      const callId =
        msg.toolCallId ??
        // fallback: scan blocks for tool_use_id (anthropic-style)
        blocks.find((b) => normalizeType(b.type) === "tool_result")?.tool_use_id ??
        blocks.find((b) => normalizeType(b.type) === "tool_result")?.toolUseId;
      if (!callId) continue;
      const owner = toolOwner.get(callId);
      if (!owner) continue;
      const tool = owner.bubble.tools.find((t) => t.id === callId);
      if (!tool) continue;
      const isErr = msg.isError === true;
      // Result body: try message-level content first; fall back to scanning
      // text blocks; for anthropic-style scan tool_result block content.
      const text =
        stringifyContent(msg.content) ??
        blocks
          .map((b) => {
            const t = normalizeType(b.type);
            if (t === "text") return asText(b);
            if (TOOL_RESULT_BLOCK_TYPES.has(t)) return stringifyContent(b.content);
            return "";
          })
          .filter(Boolean)
          .join("\n");
      if (isErr) {
        tool.status = "failed";
        tool.error = text || undefined;
      } else {
        tool.status = "done";
        tool.result = text || undefined;
      }
      continue;
    }
    // Other role types (system, etc.) — ignored.
  }

  return bubbles;
}
