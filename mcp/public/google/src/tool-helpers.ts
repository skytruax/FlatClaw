import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { GoogleApiError } from "./google-client.js";

/**
 * Wraps a tool body so any thrown error becomes structured tool output
 * the agent can act on. Surfaces GoogleApiError's status + parsed
 * response — instead of swallowing it as `err.message`, which Google
 * tends to render as a generic string with the real reason buried in
 * `error.errors[].message`.
 */
function describeError(err: unknown): string {
  if (err instanceof GoogleApiError) {
    const r = err.response as
      | { error?: { message?: string; errors?: Array<{ message?: string; reason?: string }> } }
      | undefined;
    const inner = r?.error?.errors?.[0];
    const detail = inner?.message ?? r?.error?.message ?? err.message;
    const reason = inner?.reason ? ` [${inner.reason}]` : "";
    return `Google API ${err.status ?? "error"}${reason}: ${detail}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function handleToolCall(
  fn: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return {
      content: [{ type: "text", text: `❌ ${describeError(err)}` }],
      isError: true,
    };
  }
}

export function formatData(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export function formatSuccess(message: string, data?: unknown): CallToolResult {
  const parts = [`✓ ${message}`];
  if (data !== undefined) parts.push("\n", JSON.stringify(data, null, 2));
  return { content: [{ type: "text", text: parts.join("") }] };
}

/** Base64url encode a UTF-8 string, no padding — Gmail's `raw` field format. */
export function base64urlString(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decode a base64url payload (Gmail message parts, etc.) to UTF-8 text. */
export function base64urlDecodeUtf8(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}
