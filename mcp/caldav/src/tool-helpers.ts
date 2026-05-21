import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Wraps a tool body so any thrown error becomes a structured tool result
 * the agent can actually act on. Surfaces lib-specific error fields
 * (imapflow's auth-failure flags, nodemailer's SMTP response codes, tsdav's
 * HTTP status) instead of flattening to `err.message`, which for imapflow
 * is the famously useless string `Command failed`.
 */

interface ImapflowError {
  authenticationFailed?: boolean;
  serverResponseCode?: string;
  responseText?: string;
  responseStatus?: string;
  executedCommand?: string;
}

interface NodemailerError {
  code?: string;
  responseCode?: number;
  command?: string;
  response?: string;
}

interface TsdavError {
  status?: number;
  statusText?: string;
  url?: string;
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const e = err as Error & ImapflowError & NodemailerError & TsdavError;

  // imapflow auth failure — the original "❌ Command failed" cause.
  if (e.authenticationFailed === true) {
    const reason =
      e.responseText ?? e.serverResponseCode ?? e.message ?? "unknown";
    return `IMAP authentication failed: ${reason}. The stored mailbox password is being rejected by the server. Ask your admin to rotate the email-account credential in the portal.`;
  }
  // imapflow generic protocol failure with structured detail.
  if (e.serverResponseCode || e.executedCommand) {
    const cmd = e.executedCommand ?? "<unknown command>";
    const msg = e.responseText ?? e.message ?? e.serverResponseCode ?? "no detail";
    return `IMAP ${e.responseStatus ?? "error"} during \`${cmd}\`: ${msg}`;
  }
  // nodemailer / SMTP failure.
  if (typeof e.responseCode === "number" || e.code === "EAUTH" || e.code === "ESOCKET" || e.code === "ECONNECTION") {
    const code = e.code ? `${e.code} ` : "";
    const rc = typeof e.responseCode === "number" ? `${e.responseCode} ` : "";
    const cmd = e.command ? ` during \`${e.command}\`` : "";
    const resp = e.response ?? e.message;
    return `SMTP error ${code}${rc}${cmd}: ${resp}`.trim();
  }
  // tsdav / HTTP failure (CalDAV / CardDAV).
  if (typeof e.status === "number") {
    const url = e.url ? ` (${e.url})` : "";
    return `CalDAV/CardDAV ${e.status} ${e.statusText ?? ""}${url}: ${e.message}`.trim();
  }
  return e.message;
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
