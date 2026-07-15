import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { JiraApiError } from "./jira-client.js";

interface JiraErrorResponse {
  errorMessages?: string[];
  errors?: Record<string, string>;
}

function describeError(err: unknown): string {
  if (err instanceof JiraApiError) {
    const r = err.response as JiraErrorResponse | string | undefined;
    if (r && typeof r === "object") {
      const messages = r.errorMessages ?? [];
      const fieldErrors = r.errors
        ? Object.entries(r.errors).map(([k, v]) => `${k}: ${v}`)
        : [];
      const detail = [...messages, ...fieldErrors].join("; ") || err.message;
      return `Jira ${err.status ?? "error"}: ${detail}`;
    }
    return err.message;
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

/**
 * Convert a plain-text comment / description into Atlassian Document
 * Format (ADF v1) — the structure Jira REST API v3 expects for rich
 * text fields. Multi-paragraph by `\n\n`.
 */
export function textToAdf(text: string): unknown {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.length > 0);
  if (paragraphs.length === 0) {
    return {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [] }],
    };
  }
  return {
    type: "doc",
    version: 1,
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: [{ type: "text", text: p }],
    })),
  };
}

/**
 * Render an ADF document back to plain text — best-effort, walks the
 * tree for `text` nodes and joins paragraphs with double newlines.
 */
export function adfToText(adf: unknown): string {
  if (!adf || typeof adf !== "object") return "";
  const out: string[] = [];
  function walk(node: unknown): string {
    if (!node || typeof node !== "object") return "";
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (n.type === "text" && typeof n.text === "string") return n.text;
    if (Array.isArray(n.content)) {
      const parts = n.content.map(walk);
      if (n.type === "paragraph" || n.type === "heading") {
        return parts.join("");
      }
      return parts.filter(Boolean).join("\n\n");
    }
    return "";
  }
  const root = adf as { content?: unknown[] };
  if (Array.isArray(root.content)) {
    for (const block of root.content) {
      const piece = walk(block);
      if (piece) out.push(piece);
    }
  }
  return out.join("\n\n").trim();
}
