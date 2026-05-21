import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import nodemailer, { type Transporter } from "nodemailer";
import { ImapFlow } from "imapflow";
import { resolveCreds, type MailboxCreds } from "../auth.js";
import { handleToolCall, formatSuccess } from "../tool-helpers.js";

/**
 * SMTP send + reply + forward + iTIP calendar dispatch.
 *
 * The from address is forced to the authenticated mailbox account; the
 * LLM cannot override it — defense against agents spoofing other users.
 * Most cPanel-hosted SMTP relays would reject mismatched From/AUTH
 * regardless, but we hard-pin client-side too.
 */

const RECIPIENT_LIMIT = 50;

interface AttachmentSpec {
  filename: string;
  contentType?: string;
  /** Base64-encoded content. */
  contentBase64?: string;
  /** UTF-8 string content (alternative to contentBase64). */
  content?: string;
  /** Make this attachment inline-renderable (cid). Set the cid to a unique id. */
  cid?: string;
}

const attachmentSchema = z.object({
  filename: z.string(),
  contentType: z.string().optional(),
  contentBase64: z.string().optional(),
  content: z.string().optional(),
  cid: z.string().optional(),
});

function parseRecipientList(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((s) => s.trim()).filter(Boolean);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function makeTransport(creds: MailboxCreds): Promise<Transporter> {
  return nodemailer.createTransport({
    host: creds.smtpHost,
    port: creds.smtpPort,
    secure: creds.smtpSecure,
    auth: { user: creds.email, pass: creds.password },
  });
}

function buildAttachments(
  list: AttachmentSpec[] | undefined,
): Array<{
  filename: string;
  contentType?: string;
  content: Buffer | string;
  cid?: string;
}> | undefined {
  if (!list || list.length === 0) return undefined;
  return list.map((a) => {
    if (a.contentBase64) {
      return {
        filename: a.filename,
        contentType: a.contentType,
        content: Buffer.from(a.contentBase64, "base64"),
        cid: a.cid,
      };
    }
    return {
      filename: a.filename,
      contentType: a.contentType,
      content: a.content ?? "",
      cid: a.cid,
    };
  });
}

export function registerSmtpTools(server: McpServer) {
  server.tool(
    "smtp_send_email",
    "Send an email from the authenticated mailbox. From is fixed to the connected user. Attachments accepted as base64 or UTF-8 string content.",
    {
      to: z
        .union([z.string(), z.array(z.string())])
        .describe("Recipients. String (comma-separated) or array."),
      cc: z.union([z.string(), z.array(z.string())]).optional(),
      bcc: z.union([z.string(), z.array(z.string())]).optional(),
      subject: z.string(),
      text: z.string().optional().describe("Plain-text body."),
      html: z.string().optional().describe("HTML body."),
      replyTo: z
        .string()
        .optional()
        .describe("Reply-To header. Defaults to the authenticated user."),
      inReplyTo: z
        .string()
        .optional()
        .describe("RFC 5322 Message-ID this email replies to."),
      references: z
        .array(z.string())
        .optional()
        .describe("Message-IDs for the References header (oldest first)."),
      attachments: z.array(attachmentSchema).optional(),
    },
    async (args) =>
      handleToolCall(async () => {
        if (!args.text && !args.html) {
          throw new Error("smtp_send_email requires at least one of text or html.");
        }
        const creds = await resolveCreds();
        const tos = parseRecipientList(args.to);
        const ccs = parseRecipientList(args.cc);
        const bccs = parseRecipientList(args.bcc);
        const total = tos.length + ccs.length + bccs.length;
        if (total === 0) throw new Error("at least one recipient required");
        if (total > RECIPIENT_LIMIT) {
          throw new Error(
            `total recipient count ${total} exceeds limit ${RECIPIENT_LIMIT}; split into multiple sends`,
          );
        }
        const transport = await makeTransport(creds);
        const info = await transport.sendMail({
          from: creds.email,
          to: tos.join(", "),
          cc: ccs.length ? ccs.join(", ") : undefined,
          bcc: bccs.length ? bccs.join(", ") : undefined,
          replyTo: args.replyTo ?? creds.email,
          subject: args.subject,
          text: args.text,
          html: args.html,
          inReplyTo: args.inReplyTo,
          references: args.references?.join(" "),
          attachments: buildAttachments(args.attachments),
        });
        return formatSuccess(`email sent to ${total} recipient(s)`, {
          messageId: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected,
        });
      }),
  );

  server.tool(
    "smtp_reply",
    "Reply to a fetched IMAP message by UID. Auto-sets In-Reply-To, References, Re: subject, and `\\Answered` flag on the parent. `replyAll` includes original Cc and other To recipients (deduped against the user's own address).",
    {
      mailbox: z.string().default("INBOX"),
      uid: z.number().int(),
      body: z.string().describe("Reply body, plain text."),
      bodyHtml: z.string().optional(),
      replyAll: z.boolean().optional(),
      attachments: z.array(attachmentSchema).optional(),
    },
    async ({ mailbox, uid, body, bodyHtml, replyAll, attachments }) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        // Pull the parent envelope first.
        const imap = new ImapFlow({
          host: creds.imapHost,
          port: creds.imapPort,
          secure: creds.imapSecure,
          auth: { user: creds.email, pass: creds.password },
          logger: false,
        });
        await imap.connect();
        let parent: {
          messageId?: string;
          subject?: string;
          from?: { address?: string }[];
          to?: { address?: string }[];
          cc?: { address?: string }[];
          inReplyTo?: string;
        } | null = null;
        try {
          const lock = await imap.getMailboxLock(mailbox);
          try {
            const msg = await imap.fetchOne(
              String(uid),
              { uid: true, envelope: true },
              { uid: true },
            );
            if (!msg) throw new Error(`uid ${uid} not found in ${mailbox}`);
            parent = msg.envelope ?? null;
          } finally {
            lock.release();
          }
        } finally {
          await imap.logout().catch(() => {});
        }
        if (!parent) throw new Error("could not read parent envelope");

        const fromAddr = parent.from?.[0]?.address;
        if (!fromAddr) throw new Error("parent has no From address");
        const allTo = [
          fromAddr,
          ...(replyAll
            ? [
                ...(parent.to?.map((a) => a.address).filter(Boolean) ?? []),
                ...(parent.cc?.map((a) => a.address).filter(Boolean) ?? []),
              ]
            : []),
        ]
          .filter((a): a is string => !!a && a.toLowerCase() !== creds.email.toLowerCase())
          .filter((v, i, arr) => arr.indexOf(v) === i);

        const subject = (parent.subject ?? "").trim();
        const replySubject = /^re:/i.test(subject)
          ? subject
          : `Re: ${subject}`;

        const refs = [parent.inReplyTo, parent.messageId]
          .filter(Boolean)
          .filter((v, i, arr) => arr.indexOf(v) === i) as string[];

        const transport = await makeTransport(creds);
        const info = await transport.sendMail({
          from: creds.email,
          to: allTo.join(", "),
          subject: replySubject,
          text: body,
          html: bodyHtml,
          inReplyTo: parent.messageId,
          references: refs.join(" "),
          attachments: buildAttachments(attachments),
        });

        // Mark parent answered (best-effort).
        try {
          const imap2 = new ImapFlow({
            host: creds.imapHost,
            port: creds.imapPort,
            secure: creds.imapSecure,
            auth: { user: creds.email, pass: creds.password },
            logger: false,
          });
          await imap2.connect();
          const lock = await imap2.getMailboxLock(mailbox);
          try {
            await imap2.messageFlagsAdd(String(uid), ["\\Answered"], {
              uid: true,
            });
          } finally {
            lock.release();
          }
          await imap2.logout().catch(() => {});
        } catch (err) {
          console.error("[smtp_reply] failed to flag parent answered:", err);
        }

        return formatSuccess(`reply sent to ${allTo.length} recipient(s)`, {
          messageId: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected,
        });
      }),
  );

  server.tool(
    "smtp_forward",
    "Forward a fetched IMAP message to new recipients. Preserves the original as a message/rfc822 attachment.",
    {
      mailbox: z.string().default("INBOX"),
      uid: z.number().int(),
      to: z.union([z.string(), z.array(z.string())]),
      cc: z.union([z.string(), z.array(z.string())]).optional(),
      body: z
        .string()
        .optional()
        .describe("Optional commentary above the forwarded body."),
    },
    async ({ mailbox, uid, to, cc, body }) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const imap = new ImapFlow({
          host: creds.imapHost,
          port: creds.imapPort,
          secure: creds.imapSecure,
          auth: { user: creds.email, pass: creds.password },
          logger: false,
        });
        await imap.connect();
        let source: Buffer | null = null;
        let envelope: { subject?: string } | null = null;
        try {
          const lock = await imap.getMailboxLock(mailbox);
          try {
            const msg = await imap.fetchOne(
              String(uid),
              { uid: true, source: true, envelope: true },
              { uid: true },
            );
            if (!msg) throw new Error(`uid ${uid} not found in ${mailbox}`);
            source = msg.source ?? null;
            envelope = msg.envelope ?? null;
          } finally {
            lock.release();
          }
        } finally {
          await imap.logout().catch(() => {});
        }
        if (!source) throw new Error("parent message has no source body");

        const tos = parseRecipientList(to);
        const ccs = parseRecipientList(cc);
        const subject = `Fwd: ${(envelope?.subject ?? "").trim()}`;
        const transport = await makeTransport(creds);
        const info = await transport.sendMail({
          from: creds.email,
          to: tos.join(", "),
          cc: ccs.length ? ccs.join(", ") : undefined,
          subject,
          text: body ?? "",
          attachments: [
            {
              filename: "forwarded.eml",
              contentType: "message/rfc822",
              content: source,
            },
          ],
        });
        return formatSuccess(
          `forwarded uid ${uid} to ${tos.length + ccs.length} recipient(s)`,
          {
            messageId: info.messageId,
            accepted: info.accepted,
            rejected: info.rejected,
          },
        );
      }),
  );

  server.tool(
    "smtp_send_calendar_invite",
    "Send an iTIP REQUEST email containing the supplied iCalendar event. The `iCalString` must be a complete VCALENDAR with METHOD:REQUEST. Use caldav_create_event_with_invite to do both sides at once.",
    {
      to: z
        .union([z.string(), z.array(z.string())])
        .describe("Attendee email recipients."),
      cc: z.union([z.string(), z.array(z.string())]).optional(),
      subject: z.string().describe("Email subject (e.g. 'Invitation: Project sync')."),
      text: z.string().optional(),
      iCalString: z.string().describe("Complete VCALENDAR text including METHOD:REQUEST."),
    },
    async ({ to, cc, subject, text, iCalString }) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const tos = parseRecipientList(to);
        const ccs = parseRecipientList(cc);
        if (tos.length === 0) throw new Error("at least one to-recipient required");
        const transport = await makeTransport(creds);
        const info = await transport.sendMail({
          from: creds.email,
          to: tos.join(", "),
          cc: ccs.length ? ccs.join(", ") : undefined,
          subject,
          text: text ?? "Calendar invitation attached.",
          icalEvent: { method: "REQUEST", content: iCalString, filename: "invite.ics" },
        });
        return formatSuccess(`invite dispatched to ${tos.length + ccs.length} recipient(s)`, {
          messageId: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected,
        });
      }),
  );

  server.tool(
    "smtp_send_calendar_cancel",
    "Send an iTIP CANCEL email for an existing event. The supplied iCalString must include METHOD:CANCEL with STATUS:CANCELLED and a SEQUENCE bumped above the prior one.",
    {
      to: z.union([z.string(), z.array(z.string())]),
      cc: z.union([z.string(), z.array(z.string())]).optional(),
      subject: z.string(),
      text: z.string().optional(),
      iCalString: z.string(),
    },
    async ({ to, cc, subject, text, iCalString }) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const tos = parseRecipientList(to);
        const ccs = parseRecipientList(cc);
        if (tos.length === 0) throw new Error("at least one to-recipient required");
        const transport = await makeTransport(creds);
        const info = await transport.sendMail({
          from: creds.email,
          to: tos.join(", "),
          cc: ccs.length ? ccs.join(", ") : undefined,
          subject,
          text: text ?? "Calendar event cancellation.",
          icalEvent: { method: "CANCEL", content: iCalString, filename: "cancel.ics" },
        });
        return formatSuccess(`cancel dispatched to ${tos.length + ccs.length} recipient(s)`, {
          messageId: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected,
        });
      }),
  );
}
