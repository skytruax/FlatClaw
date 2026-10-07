/**
 * OpenClaw's Tool Search, as the portal sees it.
 *
 * With `tools.toolSearch` on (OpenClaw's default since 2026.8), MCP tools are
 * not offered to the model by name. The model gets three controls instead:
 * `tool_search` to find a tool, `tool_describe` for its schema, and `tool_call`
 * to run it. Everything the portal reads back from the gateway then arrives
 * wrapped, and this module unwraps it:
 *
 *   - the transcript's toolCall block is `{name: "tool_call", arguments: {id,
 *     args}}`, where `id` is a catalog id (`mcp:<server>:<server>__<tool>`,
 *     `openclaw:core:exec`) or the plain tool name;
 *   - the toolResult text is the target's result inside an envelope,
 *     `{tool: {id, name, source}, result: {content: [...], details}}`, and
 *     that envelope sits inside the gateway's external-content markers;
 *   - a failed wrapper call is `{status: "error", tool: "tool_call", error}`;
 *   - live `agent` / `session.tool` events come twice: once for the wrapper
 *     and once for the target, the target's carrying `parentToolCallId`.
 *
 * Verified against OpenClaw 2026.9.8 on 2026-10-06; the contract probe keeps
 * checking it (`npm run test:gateway`).
 */

export const TOOL_SEARCH_CONTROLS = ["tool_search", "tool_describe", "tool_call"] as const;

/** The direct (non-deferred) tools a 2026.9.8 agent is offered when Tool Search is on. */
export const TOOL_SEARCH_DIRECT_TOOLS = [
  "apply_patch", "edit", "exec", "ls", "process", "read", "sessions_yield", "write",
  "tool_call", "tool_describe", "tool_search",
] as const;

export function isToolSearchControl(name: string): boolean {
  return (TOOL_SEARCH_CONTROLS as readonly string[]).includes(name);
}

/** True when a config document leaves Tool Search on (OpenClaw's default when unset). */
export function toolSearchEnabled(cfg: unknown): boolean {
  const tools = cfg && typeof cfg === "object" ? (cfg as { tools?: unknown }).tools : undefined;
  const value = tools && typeof tools === "object" ? (tools as { toolSearch?: unknown }).toolSearch : undefined;
  return value !== false;
}

/**
 * The gateway wraps results that came through the tool-search boundary in
 * markers so the model treats them as data. Returns the inner text, or the
 * input unchanged when there is no wrapper.
 */
export function stripExternalContent(text: string): string {
  const match = /<<<EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>\r?\n(?:Source:[^\n]*\r?\n)?---\r?\n([\s\S]*?)\r?\n?<<<END_EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/.exec(text);
  return match ? match[1] : text;
}

/** The plain tool name a catalog id or name refers to (`mcp:srv:srv__tool` → `srv__tool`). */
export function targetToolName(idOrName: unknown): string | null {
  if (typeof idOrName !== "string" || idOrName.length === 0) return null;
  const parts = idOrName.split(":");
  return parts[parts.length - 1] || null;
}

export interface UnwrappedCall {
  /** The tool that actually ran, or `tool_call` itself when the id was unreadable. */
  name: string;
  args: unknown;
  /** True when `name`/`args` came out of a tool_call wrapper. */
  wrapped: boolean;
}

/** A toolCall block or live tool event, seen through the wrapper. */
export function unwrapToolCall(name: string, args: unknown): UnwrappedCall {
  if (name !== "tool_call" || !args || typeof args !== "object") return { name, args, wrapped: false };
  const { id, args: inner } = args as { id?: unknown; args?: unknown };
  const target = targetToolName(id);
  if (!target) return { name, args, wrapped: false };
  return { name: target, args: inner, wrapped: true };
}

export interface UnwrappedResult {
  /** The target tool's own result text (its MCP text blocks joined), or the raw text. */
  text: string;
  /** The target's name as the gateway reported it, when the envelope had one. */
  targetName?: string;
  /** Set when the wrapper itself failed (unknown id, policy): the target never ran. */
  error?: string;
}

function textBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : ""))
    .filter(Boolean)
    .join("\n");
}

/** A tool_call result as the gateway stored it, seen through the envelope. */
export function unwrapToolResult(toolName: string, rawText: string): UnwrappedResult {
  const text = stripExternalContent(rawText);
  if (toolName !== "tool_call") return { text };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { text };
  }
  if (!parsed || typeof parsed !== "object") return { text };
  const envelope = parsed as {
    status?: unknown; error?: unknown;
    tool?: { id?: unknown; name?: unknown };
    result?: { content?: unknown; details?: unknown } | string;
  };
  if (envelope.status === "error" && typeof envelope.error === "string") {
    return { text, error: envelope.error };
  }
  if (envelope.tool && typeof envelope.tool === "object") {
    const targetName = targetToolName(envelope.tool.name ?? envelope.tool.id) ?? undefined;
    const inner = typeof envelope.result === "string" ? envelope.result : textBlocks(envelope.result?.content);
    return { text: inner || text, targetName };
  }
  return { text };
}
