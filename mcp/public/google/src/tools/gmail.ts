import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GoogleApiClient } from "../google-client.js";
import {
  handleToolCall,
  formatData,
  formatSuccess,
  base64urlString,
  base64urlDecodeUtf8,
} from "../tool-helpers.js";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailPart;
  raw?: string;
}

function findHeader(payload: GmailPart | undefined, name: string): string | null {
  return (
    payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())
      ?.value ?? null
  );
}

function walkParts(part: GmailPart | undefined, fn: (p: GmailPart, path: string) => void, path = "0"): void {
  if (!part) return;
  fn(part, path);
  (part.parts ?? []).forEach((c, i) => walkParts(c, fn, `${path}.${i + 1}`));
}

interface ParsedMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  subject: string | null;
  from: string | null;
  to: string | null;
  cc: string | null;
  bcc: string | null;
  date: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  bodyPlain: string;
  bodyHtml: string | null;
  attachments: Array<{
    partPath: string;
    attachmentId: string | null;
    filename: string;
    mimeType: string;
    size: number;
  }>;
}

function parseMessage(msg: GmailMessage): ParsedMessage {
  const text: string[] = [];
  const html: string[] = [];
  const attachments: ParsedMessage["attachments"] = [];
  walkParts(msg.payload, (part, path) => {
    const filename = part.filename ?? "";
    const mime = (part.mimeType ?? "").toLowerCase();
    if (filename) {
      attachments.push({
        partPath: path,
        attachmentId: part.body?.attachmentId ?? null,
        filename,
        mimeType: mime,
        size: part.body?.size ?? 0,
      });
      return;
    }
    const data = part.body?.data;
    if (!data) return;
    const decoded = base64urlDecodeUtf8(data);
    if (mime === "text/plain") text.push(decoded);
    else if (mime === "text/html") html.push(decoded);
  });
  return {
    id: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds ?? [],
    snippet: msg.snippet ?? "",
    subject: findHeader(msg.payload, "Subject"),
    from: findHeader(msg.payload, "From"),
    to: findHeader(msg.payload, "To"),
    cc: findHeader(msg.payload, "Cc"),
    bcc: findHeader(msg.payload, "Bcc"),
    date: findHeader(msg.payload, "Date"),
    messageId: findHeader(msg.payload, "Message-ID"),
    inReplyTo: findHeader(msg.payload, "In-Reply-To"),
    references: findHeader(msg.payload, "References"),
    bodyPlain: text.join("\n").trim(),
    bodyHtml: html.length > 0 ? html.join("\n") : null,
    attachments,
  };
}

function encodeMimeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

interface AttachmentSpec {
  filename: string;
  contentType?: string;
  contentBase64?: string;
  content?: string;
}

const attachmentSchema = z.object({
  filename: z.string(),
  contentType: z.string().optional(),
  contentBase64: z.string().optional(),
  content: z.string().optional(),
});

function buildRfc822(args: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: AttachmentSpec[];
}): string {
  const boundary = `bnd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const altBoundary = `alt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const lines: string[] = [];
  lines.push(`From: ${args.from}`);
  lines.push(`To: ${args.to}`);
  if (args.cc) lines.push(`Cc: ${args.cc}`);
  if (args.bcc) lines.push(`Bcc: ${args.bcc}`);
  lines.push(`Subject: ${encodeMimeHeader(args.subject)}`);
  lines.push("MIME-Version: 1.0");
  if (args.inReplyTo) lines.push(`In-Reply-To: ${args.inReplyTo}`);
  if (args.references) lines.push(`References: ${args.references}`);

  const hasAttachments = (args.attachments?.length ?? 0) > 0;
  const hasHtml = !!args.bodyHtml;

  if (!hasAttachments && !hasHtml) {
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push("Content-Transfer-Encoding: 8bit");
    lines.push("");
    lines.push(args.body);
    return lines.join("\r\n");
  }

  if (!hasAttachments && hasHtml) {
    lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    lines.push("");
    lines.push(`--${altBoundary}`);
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push("Content-Transfer-Encoding: 8bit");
    lines.push("");
    lines.push(args.body);
    lines.push(`--${altBoundary}`);
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push("Content-Transfer-Encoding: 8bit");
    lines.push("");
    lines.push(args.bodyHtml ?? "");
    lines.push(`--${altBoundary}--`);
    return lines.join("\r\n");
  }

  // Mixed (attachments) — wrap text/alternative inside.
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push("");
  lines.push(`--${boundary}`);
  if (hasHtml) {
    lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    lines.push("");
    lines.push(`--${altBoundary}`);
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push("Content-Transfer-Encoding: 8bit");
    lines.push("");
    lines.push(args.body);
    lines.push(`--${altBoundary}`);
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push("Content-Transfer-Encoding: 8bit");
    lines.push("");
    lines.push(args.bodyHtml ?? "");
    lines.push(`--${altBoundary}--`);
  } else {
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push("Content-Transfer-Encoding: 8bit");
    lines.push("");
    lines.push(args.body);
  }
  for (const a of args.attachments ?? []) {
    lines.push(`--${boundary}`);
    const ct = a.contentType ?? "application/octet-stream";
    lines.push(`Content-Type: ${ct}; name="${a.filename}"`);
    lines.push("Content-Transfer-Encoding: base64");
    lines.push(`Content-Disposition: attachment; filename="${a.filename}"`);
    lines.push("");
    const content = a.contentBase64
      ? a.contentBase64
      : Buffer.from(a.content ?? "", "utf8").toString("base64");
    // Wrap base64 to 76-col lines (RFC 2045 §6.8).
    for (let i = 0; i < content.length; i += 76) {
      lines.push(content.slice(i, i + 76));
    }
  }
  lines.push(`--${boundary}--`);
  return lines.join("\r\n");
}

export function registerGmailTools(server: McpServer, api: GoogleApiClient): void {
  server.tool(
    "gmail_send",
    "Send an email from the connected Google account. From is fixed to the connected account. Optional reply threading via reply_to_message_id (auto-fetches In-Reply-To/References). Attachments accept base64 or UTF-8 string content.",
    {
      to: z.string().describe("Recipients (comma-separated string)."),
      subject: z.string(),
      body: z.string().describe("Plain-text body."),
      bodyHtml: z.string().optional(),
      cc: z.string().optional(),
      bcc: z.string().optional(),
      reply_to_message_id: z
        .string()
        .optional()
        .describe(
          "Gmail message id to reply to. Auto-prefixes 'Re:' to subject (if not already), copies threading headers, sends within the same threadId.",
        ),
      thread_id: z.string().optional().describe("Send within an existing threadId."),
      attachments: z.array(attachmentSchema).optional(),
    },
    async (args) =>
      handleToolCall(async () => {
        const from = api.identityHint() ?? "me";
        let inReplyTo: string | undefined;
        let references: string | undefined;
        let threadId = args.thread_id;
        let subject = args.subject;
        if (args.reply_to_message_id) {
          const parent = await api.request<GmailMessage>(
            `${GMAIL}/messages/${encodeURIComponent(args.reply_to_message_id)}`,
            {
              query: {
                format: "metadata",
                metadataHeaders: ["Message-ID", "References", "Subject"],
              },
            },
          );
          threadId = parent.threadId;
          const messageId = findHeader(parent.payload, "Message-ID");
          const prevReferences = findHeader(parent.payload, "References");
          const prevSubject = findHeader(parent.payload, "Subject");
          if (messageId) inReplyTo = messageId;
          references = [prevReferences, messageId].filter(Boolean).join(" ");
          if (prevSubject && !/^re:/i.test(args.subject)) {
            subject = /^re:/i.test(prevSubject) ? prevSubject : `Re: ${prevSubject}`;
          }
        }
        const rfc822 = buildRfc822({
          from,
          to: args.to,
          cc: args.cc,
          bcc: args.bcc,
          subject,
          body: args.body,
          bodyHtml: args.bodyHtml,
          inReplyTo,
          references,
          attachments: args.attachments,
        });
        const sendBody: Record<string, unknown> = { raw: base64urlString(rfc822) };
        if (threadId) sendBody.threadId = threadId;
        const result = await api.request(`${GMAIL}/messages/send`, {
          method: "POST",
          json: sendBody,
        });
        return formatSuccess("email sent", result);
      }),
  );

  server.tool(
    "gmail_search",
    "Search the user's Gmail using Gmail's query syntax (e.g. 'in:inbox newer_than:7d from:alice'). Returns id/threadId/snippet/subject/from/date per result. For relative date queries (`after:`, `before:`) Gmail accepts `YYYY/MM/DD` — if you don't know today's date, call `exec` with `node -e \"console.log(new Date().toISOString())\"` first; do not guess.",
    {
      query: z.string(),
      max: z.number().int().min(1).max(500).optional(),
      include_spam_trash: z.boolean().optional(),
    },
    async (args) =>
      handleToolCall(async () => {
        const list = await api.request<{
          messages?: Array<{ id: string; threadId: string }>;
          resultSizeEstimate?: number;
        }>(`${GMAIL}/messages`, {
          query: {
            q: args.query,
            maxResults: args.max ?? 20,
            includeSpamTrash: args.include_spam_trash,
          },
        });
        const ids = list.messages ?? [];
        const messages = await Promise.all(
          ids.map(async (m) => {
            const full = await api.request<GmailMessage>(
              `${GMAIL}/messages/${m.id}`,
              {
                query: {
                  format: "metadata",
                  metadataHeaders: ["Subject", "From", "Date"],
                },
              },
            );
            return {
              id: full.id,
              threadId: full.threadId,
              snippet: full.snippet,
              subject: findHeader(full.payload, "Subject"),
              from: findHeader(full.payload, "From"),
              date: findHeader(full.payload, "Date"),
            };
          }),
        );
        return formatData({
          messages,
          resultSizeEstimate: list.resultSizeEstimate,
        });
      }),
  );

  server.tool(
    "gmail_get",
    "Fetch a Gmail message. Returns parsed headers, plain-text body, html body (if any), and attachment metadata.",
    {
      message_id: z.string(),
      format: z
        .enum(["full", "metadata", "raw", "minimal"])
        .optional()
        .describe("Default: full."),
    },
    async ({ message_id, format }) =>
      handleToolCall(async () => {
        const msg = await api.request<GmailMessage>(
          `${GMAIL}/messages/${encodeURIComponent(message_id)}`,
          { query: { format: format ?? "full" } },
        );
        return formatData(parseMessage(msg));
      }),
  );

  server.tool(
    "gmail_get_attachment",
    "Download a specific attachment from a Gmail message. Returns base64 content + size + content-type.",
    {
      message_id: z.string(),
      attachment_id: z.string(),
      filename: z.string().optional(),
    },
    async ({ message_id, attachment_id, filename }) =>
      handleToolCall(async () => {
        const att = await api.request<{ size?: number; data?: string }>(
          `${GMAIL}/messages/${encodeURIComponent(message_id)}/attachments/${encodeURIComponent(attachment_id)}`,
        );
        return formatData({
          filename: filename ?? null,
          size: att.size ?? 0,
          base64: att.data
            ? Buffer.from(att.data, "base64url").toString("base64")
            : null,
        });
      }),
  );

  server.tool(
    "gmail_modify",
    "Add or remove labels on a single Gmail message. Common builtin labels: INBOX, UNREAD, STARRED, IMPORTANT, TRASH, SPAM, SENT, DRAFT.",
    {
      message_id: z.string(),
      add: z.array(z.string()).optional(),
      remove: z.array(z.string()).optional(),
    },
    async ({ message_id, add, remove }) =>
      handleToolCall(async () => {
        const result = await api.request(
          `${GMAIL}/messages/${encodeURIComponent(message_id)}/modify`,
          {
            method: "POST",
            json: {
              addLabelIds: add ?? [],
              removeLabelIds: remove ?? [],
            },
          },
        );
        return formatSuccess(`labels updated on ${message_id}`, result);
      }),
  );

  server.tool(
    "gmail_batch_modify",
    "Add or remove labels on multiple Gmail messages in one call (Gmail batchModify endpoint).",
    {
      message_ids: z.array(z.string()).min(1).max(1000),
      add: z.array(z.string()).optional(),
      remove: z.array(z.string()).optional(),
    },
    async ({ message_ids, add, remove }) =>
      handleToolCall(async () => {
        await api.request(`${GMAIL}/messages/batchModify`, {
          method: "POST",
          json: {
            ids: message_ids,
            addLabelIds: add ?? [],
            removeLabelIds: remove ?? [],
          },
        });
        return formatSuccess(
          `batch label update on ${message_ids.length} message(s)`,
        );
      }),
  );

  server.tool(
    "gmail_trash",
    "Move messages to Trash (recoverable, 30-day Gmail policy).",
    {
      message_ids: z.array(z.string()).min(1).max(100),
    },
    async ({ message_ids }) =>
      handleToolCall(async () => {
        for (const id of message_ids) {
          await api.request(
            `${GMAIL}/messages/${encodeURIComponent(id)}/trash`,
            { method: "POST" },
          );
        }
        return formatSuccess(`trashed ${message_ids.length} message(s)`);
      }),
  );

  server.tool(
    "gmail_untrash",
    "Restore messages from Trash.",
    {
      message_ids: z.array(z.string()).min(1).max(100),
    },
    async ({ message_ids }) =>
      handleToolCall(async () => {
        for (const id of message_ids) {
          await api.request(
            `${GMAIL}/messages/${encodeURIComponent(id)}/untrash`,
            { method: "POST" },
          );
        }
        return formatSuccess(`untrashed ${message_ids.length} message(s)`);
      }),
  );

  server.tool(
    "gmail_list_labels",
    "List the user's Gmail labels (system + user-defined).",
    {},
    async () =>
      handleToolCall(async () => {
        const r = await api.request<{ labels?: unknown[] }>(`${GMAIL}/labels`);
        return formatData(r.labels ?? []);
      }),
  );

  server.tool(
    "gmail_create_label",
    "Create a new user-defined Gmail label.",
    {
      name: z.string(),
      label_list_visibility: z
        .enum(["labelShow", "labelShowIfUnread", "labelHide"])
        .optional(),
      message_list_visibility: z.enum(["show", "hide"]).optional(),
    },
    async ({ name, label_list_visibility, message_list_visibility }) =>
      handleToolCall(async () => {
        const result = await api.request(`${GMAIL}/labels`, {
          method: "POST",
          json: {
            name,
            labelListVisibility: label_list_visibility ?? "labelShow",
            messageListVisibility: message_list_visibility ?? "show",
          },
        });
        return formatSuccess(`label created: ${name}`, result);
      }),
  );

  server.tool(
    "gmail_get_thread",
    "Fetch every message in a Gmail thread, parsed.",
    {
      thread_id: z.string(),
    },
    async ({ thread_id }) =>
      handleToolCall(async () => {
        const t = await api.request<{ messages?: GmailMessage[] }>(
          `${GMAIL}/threads/${encodeURIComponent(thread_id)}`,
          { query: { format: "full" } },
        );
        const messages = (t.messages ?? []).map(parseMessage);
        return formatData({ thread_id, messages });
      }),
  );

  server.tool(
    "gmail_create_draft",
    "Create a Gmail draft. Same shape as gmail_send; nothing is delivered.",
    {
      to: z.string(),
      subject: z.string(),
      body: z.string(),
      bodyHtml: z.string().optional(),
      cc: z.string().optional(),
      bcc: z.string().optional(),
      attachments: z.array(attachmentSchema).optional(),
    },
    async (args) =>
      handleToolCall(async () => {
        const from = api.identityHint() ?? "me";
        const rfc822 = buildRfc822({
          from,
          to: args.to,
          cc: args.cc,
          bcc: args.bcc,
          subject: args.subject,
          body: args.body,
          bodyHtml: args.bodyHtml,
          attachments: args.attachments,
        });
        const result = await api.request(`${GMAIL}/drafts`, {
          method: "POST",
          json: { message: { raw: base64urlString(rfc822) } },
        });
        return formatSuccess("draft created", result);
      }),
  );

  server.tool(
    "gmail_list_drafts",
    "List the user's Gmail drafts (id + message id).",
    { max: z.number().int().min(1).max(500).optional() },
    async ({ max }) =>
      handleToolCall(async () => {
        const r = await api.request(`${GMAIL}/drafts`, {
          query: { maxResults: max ?? 50 },
        });
        return formatData(r);
      }),
  );

  server.tool(
    "gmail_send_draft",
    "Send a previously-created Gmail draft by its draft id.",
    { draft_id: z.string() },
    async ({ draft_id }) =>
      handleToolCall(async () => {
        const result = await api.request(`${GMAIL}/drafts/send`, {
          method: "POST",
          json: { id: draft_id },
        });
        return formatSuccess("draft sent", result);
      }),
  );

  server.tool(
    "gmail_delete_draft",
    "Delete a Gmail draft by id.",
    { draft_id: z.string() },
    async ({ draft_id }) =>
      handleToolCall(async () => {
        await api.request(
          `${GMAIL}/drafts/${encodeURIComponent(draft_id)}`,
          { method: "DELETE" },
        );
        return formatSuccess(`draft ${draft_id} deleted`);
      }),
  );
}
