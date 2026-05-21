import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ImapFlow, type FetchMessageObject } from "imapflow";
import { resolveCreds } from "../auth.js";
import { handleToolCall, formatData, formatSuccess } from "../tool-helpers.js";

/**
 * IMAP tools: read, flag, move, copy, archive, trash, delete, expunge,
 * search (extended), attachments, threading, mailbox admin.
 *
 * Per-call fresh ImapFlow connection — cheap on the LLM call cadence.
 * imapflow has its own internal connection state that's explicitly NOT
 * thread-safe, so reusing across overlapping calls is more risk than win.
 */

async function withImap<T>(
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const creds = await resolveCreds();
  const client = new ImapFlow({
    host: creds.imapHost,
    port: creds.imapPort,
    secure: creds.imapSecure,
    auth: { user: creds.email, pass: creds.password },
    logger: false,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Map friendly flag aliases to RFC-3501 IMAP flags. Anything else passes through verbatim. */
function normalizeFlag(f: string): string {
  const map: Record<string, string> = {
    seen: "\\Seen",
    read: "\\Seen",
    unread: "\\Seen", // (caller should use the `remove` arm)
    flagged: "\\Flagged",
    starred: "\\Flagged",
    answered: "\\Answered",
    replied: "\\Answered",
    deleted: "\\Deleted",
    draft: "\\Draft",
    recent: "\\Recent",
  };
  return map[f.toLowerCase()] ?? f;
}

/** Find an existing mailbox by `specialUse` flag (e.g. `\Archive`, `\Trash`). */
async function findSpecialUseMailbox(
  client: ImapFlow,
  specialUse: string,
): Promise<string | null> {
  const list = await client.list();
  const m = list.find((m) => m.specialUse === specialUse);
  return m?.path ?? null;
}

export function registerImapTools(server: McpServer) {
  // ---- read ----------------------------------------------------------

  server.tool(
    "imap_list_mailboxes",
    "List IMAP mailboxes (folders) on the user's account, e.g. INBOX, Sent, Drafts.",
    {},
    async () =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const list = await client.list();
          return formatData(
            list.map((m) => ({
              path: m.path,
              flags: Array.from(m.flags ?? []),
              specialUse: m.specialUse,
              subscribed: m.subscribed,
            })),
          );
        }),
      ),
  );

  server.tool(
    "imap_list_recent",
    "List the most recent N message envelopes from a mailbox (default INBOX, 20 messages). Returns from / to / subject / date / uid — no body.",
    {
      mailbox: z.string().default("INBOX").describe("Mailbox path. Default INBOX."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(20)
        .describe("How many messages to return (1-200, default 20)."),
    },
    async ({ mailbox, limit }) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const lock = await client.getMailboxLock(mailbox);
          try {
            const status = client.mailbox;
            if (typeof status === "boolean" || !status) {
              throw new Error(`mailbox not opened: ${mailbox}`);
            }
            const total = status.exists ?? 0;
            if (total === 0) return formatData([]);
            const start = Math.max(1, total - limit + 1);
            const range = `${start}:${total}`;
            const envelopes: unknown[] = [];
            for await (const msg of client.fetch(range, {
              uid: true,
              envelope: true,
              flags: true,
              size: true,
            })) {
              envelopes.push(envelopeOut(msg));
            }
            envelopes.reverse();
            return formatData(envelopes);
          } finally {
            lock.release();
          }
        }),
      ),
  );

  server.tool(
    "imap_read_message",
    "Fetch the full body (text + html) of a single IMAP message by UID. Mailbox defaults to INBOX.",
    {
      uid: z.number().int().describe("IMAP UID, from imap_list_recent or imap_search."),
      mailbox: z.string().default("INBOX"),
    },
    async ({ uid, mailbox }) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const lock = await client.getMailboxLock(mailbox);
          try {
            const msg = await client.fetchOne(
              String(uid),
              { uid: true, source: true, envelope: true, bodyStructure: true, flags: true },
              { uid: true },
            );
            if (!msg) throw new Error(`uid ${uid} not found in ${mailbox}`);
            const parts: { text?: string; html?: string } = {};
            try {
              const dl = await client.download(String(uid), "TEXT", { uid: true });
              if (dl?.content) parts.text = await streamToString(dl.content);
            } catch {
              /* mailbox may not have plain text */
            }
            const attachmentParts = walkBodyStructureForAttachments(
              msg.bodyStructure,
              "",
            );
            return formatData({
              uid: msg.uid,
              flags: Array.from(msg.flags ?? []),
              envelope: msg.envelope,
              source: msg.source ? msg.source.toString("utf-8") : null,
              parts,
              attachments: attachmentParts.map((a) => ({
                partPath: a.partPath,
                filename: a.filename,
                contentType: a.contentType,
                size: a.size,
              })),
            });
          } finally {
            lock.release();
          }
        }),
      ),
  );

  server.tool(
    "imap_search",
    "IMAP search across a mailbox. Combine any of from / to / subject / body / sinceISO / untilISO / unseen / hasAttachment / header.",
    {
      mailbox: z.string().default("INBOX"),
      from: z.string().optional(),
      to: z.string().optional(),
      subject: z.string().optional(),
      body: z.string().optional().describe("Substring match across message body."),
      sinceISO: z.string().optional(),
      untilISO: z.string().optional(),
      unseen: z.boolean().optional(),
      seen: z.boolean().optional(),
      flagged: z.boolean().optional(),
      hasAttachment: z
        .boolean()
        .optional()
        .describe(
          "Post-filter on bodyStructure — IMAP has no native HASATTACH search.",
        ),
      headerName: z.string().optional().describe("Custom header name to match."),
      headerValue: z.string().optional().describe("Custom header value (substring)."),
      limit: z.number().int().min(1).max(500).default(50),
    },
    async (args) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const lock = await client.getMailboxLock(args.mailbox);
          try {
            const query: Record<string, unknown> = {};
            if (args.from) query.from = args.from;
            if (args.to) query.to = args.to;
            if (args.subject) query.subject = args.subject;
            if (args.body) query.body = args.body;
            if (args.sinceISO) query.since = new Date(args.sinceISO);
            if (args.untilISO) query.before = new Date(args.untilISO);
            if (args.unseen) query.unseen = true;
            if (args.seen) query.seen = true;
            if (args.flagged) query.flagged = true;
            if (args.headerName && args.headerValue) {
              query.header = { [args.headerName]: args.headerValue };
            }
            const uids = (await client.search(query, { uid: true })) as
              | number[]
              | false;
            if (!uids || uids.length === 0) return formatData([]);
            const trimmed = uids.slice(-args.limit);
            const out: unknown[] = [];
            for await (const msg of client.fetch(
              trimmed.join(","),
              {
                uid: true,
                envelope: true,
                flags: true,
                bodyStructure: !!args.hasAttachment,
                size: true,
              },
              { uid: true },
            )) {
              if (args.hasAttachment) {
                const has = walkBodyStructureForAttachments(
                  msg.bodyStructure,
                  "",
                );
                if (has.length === 0) continue;
              }
              out.push(envelopeOut(msg));
            }
            out.reverse();
            return formatData(out);
          } finally {
            lock.release();
          }
        }),
      ),
  );

  // ---- flags / move / copy / delete ---------------------------------

  server.tool(
    "imap_set_flags",
    "Add and/or remove IMAP flags on one or more messages. Common flags: \\Seen (read), \\Flagged (starred), \\Answered, \\Deleted. Friendly aliases accepted: seen|read|flagged|starred|answered|replied|deleted.",
    {
      mailbox: z.string().default("INBOX"),
      uids: z.array(z.number().int()).min(1),
      add: z.array(z.string()).optional(),
      remove: z.array(z.string()).optional(),
    },
    async ({ mailbox, uids, add, remove }) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const lock = await client.getMailboxLock(mailbox);
          try {
            if (add?.length) {
              await client.messageFlagsAdd(
                uids.join(","),
                add.map(normalizeFlag),
                { uid: true },
              );
            }
            if (remove?.length) {
              await client.messageFlagsRemove(
                uids.join(","),
                remove.map(normalizeFlag),
                { uid: true },
              );
            }
            return formatSuccess(
              `flags updated on ${uids.length} message(s) in ${mailbox}`,
              {
                added: add?.map(normalizeFlag) ?? [],
                removed: remove?.map(normalizeFlag) ?? [],
              },
            );
          } finally {
            lock.release();
          }
        }),
      ),
  );

  server.tool(
    "imap_mark_read",
    "Convenience: mark messages as read (\\Seen flag).",
    {
      mailbox: z.string().default("INBOX"),
      uids: z.array(z.number().int()).min(1),
    },
    async ({ mailbox, uids }) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const lock = await client.getMailboxLock(mailbox);
          try {
            await client.messageFlagsAdd(uids.join(","), ["\\Seen"], {
              uid: true,
            });
            return formatSuccess(`marked ${uids.length} as read`);
          } finally {
            lock.release();
          }
        }),
      ),
  );

  server.tool(
    "imap_mark_unread",
    "Convenience: mark messages as unread (remove \\Seen).",
    {
      mailbox: z.string().default("INBOX"),
      uids: z.array(z.number().int()).min(1),
    },
    async ({ mailbox, uids }) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const lock = await client.getMailboxLock(mailbox);
          try {
            await client.messageFlagsRemove(uids.join(","), ["\\Seen"], {
              uid: true,
            });
            return formatSuccess(`marked ${uids.length} as unread`);
          } finally {
            lock.release();
          }
        }),
      ),
  );

  server.tool(
    "imap_move",
    "Move messages to another mailbox (preserves UIDs server-side as a UID-MOVE if supported).",
    {
      mailbox: z.string().default("INBOX"),
      uids: z.array(z.number().int()).min(1),
      destination: z.string(),
    },
    async ({ mailbox, uids, destination }) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const lock = await client.getMailboxLock(mailbox);
          try {
            const result = await client.messageMove(
              uids.join(","),
              destination,
              { uid: true },
            );
            return formatSuccess(
              `moved ${uids.length} message(s) to ${destination}`,
              result,
            );
          } finally {
            lock.release();
          }
        }),
      ),
  );

  server.tool(
    "imap_copy",
    "Copy messages to another mailbox without removing them from the source.",
    {
      mailbox: z.string().default("INBOX"),
      uids: z.array(z.number().int()).min(1),
      destination: z.string(),
    },
    async ({ mailbox, uids, destination }) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const lock = await client.getMailboxLock(mailbox);
          try {
            const result = await client.messageCopy(
              uids.join(","),
              destination,
              { uid: true },
            );
            return formatSuccess(
              `copied ${uids.length} message(s) to ${destination}`,
              result,
            );
          } finally {
            lock.release();
          }
        }),
      ),
  );

  server.tool(
    "imap_archive",
    "Move messages to the user's Archive folder. Auto-discovers it via the IMAP SPECIAL-USE \\Archive flag, falling back to a folder literally named 'Archive'.",
    {
      mailbox: z.string().default("INBOX"),
      uids: z.array(z.number().int()).min(1),
    },
    async ({ mailbox, uids }) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const archive =
            (await findSpecialUseMailbox(client, "\\Archive")) ?? "Archive";
          const lock = await client.getMailboxLock(mailbox);
          try {
            const result = await client.messageMove(uids.join(","), archive, {
              uid: true,
            });
            return formatSuccess(
              `archived ${uids.length} message(s) → ${archive}`,
              result,
            );
          } finally {
            lock.release();
          }
        }),
      ),
  );

  server.tool(
    "imap_trash",
    "Move messages to the user's Trash folder. Auto-discovers via SPECIAL-USE \\Trash, falling back to 'Trash'.",
    {
      mailbox: z.string().default("INBOX"),
      uids: z.array(z.number().int()).min(1),
    },
    async ({ mailbox, uids }) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const trash =
            (await findSpecialUseMailbox(client, "\\Trash")) ?? "Trash";
          const lock = await client.getMailboxLock(mailbox);
          try {
            const result = await client.messageMove(uids.join(","), trash, {
              uid: true,
            });
            return formatSuccess(
              `trashed ${uids.length} message(s) → ${trash}`,
              result,
            );
          } finally {
            lock.release();
          }
        }),
      ),
  );

  server.tool(
    "imap_delete",
    "PERMANENTLY delete messages: marks \\Deleted then EXPUNGEs. Use imap_trash if you want soft-delete (recoverable).",
    {
      mailbox: z.string().default("INBOX"),
      uids: z.array(z.number().int()).min(1),
    },
    async ({ mailbox, uids }) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const lock = await client.getMailboxLock(mailbox);
          try {
            await client.messageFlagsAdd(uids.join(","), ["\\Deleted"], {
              uid: true,
            });
            await client.messageDelete(uids.join(","), { uid: true });
            return formatSuccess(
              `permanently deleted ${uids.length} message(s) from ${mailbox}`,
            );
          } finally {
            lock.release();
          }
        }),
      ),
  );

  server.tool(
    "imap_expunge",
    "Expunge a mailbox: permanently removes every message currently flagged \\Deleted.",
    { mailbox: z.string().default("INBOX") },
    async ({ mailbox }) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const lock = await client.getMailboxLock(mailbox);
          try {
            await client.messageDelete({ deleted: true });
            return formatSuccess(`expunged ${mailbox}`);
          } finally {
            lock.release();
          }
        }),
      ),
  );

  // ---- attachments + threading --------------------------------------

  server.tool(
    "imap_list_attachments",
    "Inspect attachments on a message without downloading them. Returns each attachment's part path (use with imap_get_attachment), filename, content type, size.",
    {
      mailbox: z.string().default("INBOX"),
      uid: z.number().int(),
    },
    async ({ mailbox, uid }) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const lock = await client.getMailboxLock(mailbox);
          try {
            const msg = await client.fetchOne(
              String(uid),
              { uid: true, bodyStructure: true },
              { uid: true },
            );
            if (!msg) throw new Error(`uid ${uid} not found in ${mailbox}`);
            const parts = walkBodyStructureForAttachments(msg.bodyStructure, "");
            return formatData(parts);
          } finally {
            lock.release();
          }
        }),
      ),
  );

  server.tool(
    "imap_get_attachment",
    "Download one attachment by its bodyStructure part path (from imap_list_attachments). Returns base64-encoded content with size + filename + contentType.",
    {
      mailbox: z.string().default("INBOX"),
      uid: z.number().int(),
      partPath: z
        .string()
        .describe("Part path string from imap_list_attachments, e.g. '2' or '1.2.3'."),
      maxBytes: z
        .number()
        .int()
        .min(1)
        .max(50 * 1024 * 1024)
        .default(10 * 1024 * 1024)
        .describe("Truncate downloads larger than this. Default 10 MiB."),
    },
    async ({ mailbox, uid, partPath, maxBytes }) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const lock = await client.getMailboxLock(mailbox);
          try {
            const msg = await client.fetchOne(
              String(uid),
              { uid: true, bodyStructure: true },
              { uid: true },
            );
            if (!msg) throw new Error(`uid ${uid} not found in ${mailbox}`);
            const parts = walkBodyStructureForAttachments(msg.bodyStructure, "");
            const target = parts.find((p) => p.partPath === partPath);
            if (!target) {
              throw new Error(
                `partPath ${partPath} not found among attachments. Available: ${parts.map((p) => p.partPath).join(", ") || "(none)"}`,
              );
            }
            const dl = await client.download(String(uid), partPath, {
              uid: true,
            });
            if (!dl?.content) throw new Error("download returned no content");
            const buf = await streamToBuffer(dl.content, maxBytes);
            return formatData({
              uid,
              partPath,
              filename: target.filename,
              contentType: target.contentType,
              size: buf.length,
              truncated: buf.length === maxBytes,
              base64: buf.toString("base64"),
            });
          } finally {
            lock.release();
          }
        }),
      ),
  );

  server.tool(
    "imap_thread",
    "Find related messages by Message-ID + References across mailboxes. Returns every message whose Message-ID matches `messageId` or whose References / In-Reply-To headers contain it.",
    {
      messageId: z
        .string()
        .describe("RFC 5322 Message-ID, e.g. '<abc@example.com>'."),
      mailboxes: z
        .array(z.string())
        .optional()
        .describe("Mailboxes to search. Defaults to all subscribed."),
    },
    async ({ messageId, mailboxes }) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const list = await client.list();
          const targets =
            mailboxes && mailboxes.length > 0
              ? mailboxes
              : list.filter((m) => m.subscribed !== false).map((m) => m.path);
          const out: Array<{
            mailbox: string;
            uid: number;
            from?: { name?: string; address?: string }[];
            subject?: string;
            date?: Date | string;
          }> = [];
          for (const path of targets) {
            try {
              const lock = await client.getMailboxLock(path);
              try {
                const a = (await client.search(
                  { header: { "message-id": messageId } },
                  { uid: true },
                )) as number[] | false;
                const b = (await client.search(
                  { header: { references: messageId } },
                  { uid: true },
                )) as number[] | false;
                const c = (await client.search(
                  { header: { "in-reply-to": messageId } },
                  { uid: true },
                )) as number[] | false;
                const uids = Array.from(
                  new Set([...(a || []), ...(b || []), ...(c || [])]),
                );
                if (uids.length === 0) continue;
                for await (const msg of client.fetch(
                  uids.join(","),
                  { uid: true, envelope: true, flags: true },
                  { uid: true },
                )) {
                  out.push({
                    mailbox: path,
                    uid: msg.uid,
                    from: msg.envelope?.from?.map((a) => ({
                      name: a.name,
                      address: a.address,
                    })),
                    subject: msg.envelope?.subject,
                    date: msg.envelope?.date,
                  });
                }
              } finally {
                lock.release();
              }
            } catch (err) {
              // Mailbox might not exist or might not allow open — keep walking.
              console.error(`[imap_thread] skipping ${path}:`, err);
            }
          }
          return formatData(out);
        }),
      ),
  );

  // ---- mailbox admin ------------------------------------------------

  server.tool(
    "imap_mailbox_create",
    "Create a new IMAP mailbox (folder). Path uses the server's hierarchy delimiter, often '.' or '/'. e.g. 'INBOX.Project-X' or 'Archive/2026'.",
    { path: z.string() },
    async ({ path }) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const r = await client.mailboxCreate(path);
          return formatSuccess(`created mailbox ${path}`, r);
        }),
      ),
  );

  server.tool(
    "imap_mailbox_rename",
    "Rename a mailbox.",
    { path: z.string(), newPath: z.string() },
    async ({ path, newPath }) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const r = await client.mailboxRename(path, newPath);
          return formatSuccess(`renamed ${path} → ${newPath}`, r);
        }),
      ),
  );

  server.tool(
    "imap_mailbox_delete",
    "Delete a mailbox. The mailbox must be empty on most servers; consider expunging first.",
    { path: z.string() },
    async ({ path }) =>
      handleToolCall(async () =>
        withImap(async (client) => {
          const r = await client.mailboxDelete(path);
          return formatSuccess(`deleted mailbox ${path}`, r);
        }),
      ),
  );
}

// ---- helpers ---------------------------------------------------------

function envelopeOut(msg: FetchMessageObject): unknown {
  return {
    uid: msg.uid,
    seq: msg.seq,
    size: msg.size,
    flags: Array.from(msg.flags ?? []),
    from: msg.envelope?.from?.map((a) => ({ name: a.name, address: a.address })),
    to: msg.envelope?.to?.map((a) => ({ name: a.name, address: a.address })),
    cc: msg.envelope?.cc?.map((a) => ({ name: a.name, address: a.address })),
    subject: msg.envelope?.subject,
    date: msg.envelope?.date,
    messageId: msg.envelope?.messageId,
    inReplyTo: msg.envelope?.inReplyTo,
  };
}

interface AttachmentPart {
  partPath: string;
  filename: string;
  contentType: string;
  size: number;
}

interface BodyStructureNode {
  type?: string;
  subtype?: string;
  disposition?: string;
  dispositionParameters?: { filename?: string };
  parameters?: { name?: string };
  size?: number;
  childNodes?: BodyStructureNode[];
}

function walkBodyStructureForAttachments(
  bs: unknown,
  prefix: string,
): AttachmentPart[] {
  const node = bs as BodyStructureNode | undefined;
  if (!node) return [];
  const out: AttachmentPart[] = [];
  const isMultipart = (node.type ?? "").toLowerCase() === "multipart";
  if (isMultipart && node.childNodes) {
    node.childNodes.forEach((child, i) => {
      const childPath = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      out.push(...walkBodyStructureForAttachments(child, childPath));
    });
    return out;
  }
  // Leaf — is it an attachment?
  const dispo = (node.disposition ?? "").toLowerCase();
  const filename =
    node.dispositionParameters?.filename ?? node.parameters?.name;
  if (dispo === "attachment" || (dispo === "inline" && filename)) {
    out.push({
      partPath: prefix || "1",
      filename: filename ?? "(unnamed)",
      contentType: `${(node.type ?? "application").toLowerCase()}/${(node.subtype ?? "octet-stream").toLowerCase()}`,
      size: node.size ?? 0,
    });
  }
  return out;
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function streamToBuffer(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    chunks.push(buf);
    total += buf.length;
    if (total >= maxBytes) break;
  }
  return Buffer.concat(chunks).subarray(0, maxBytes);
}
