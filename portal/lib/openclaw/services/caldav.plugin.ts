/**
 * CalDav MCP service plugin.
 *
 * Mailbox-account access (CalDAV / CardDAV / IMAP / SMTP) authenticated by
 * email-account password. Each FlatClaw user owns their own mailbox slot.
 */
import {
  registerManagedMcpService,
  type ManagedCredentialStatus,
} from "../managed-mcp";
import {
  setCaldavCredential,
  readCaldavStatus,
  deleteCaldavCredential,
} from "@/lib/credentials/caldav";

registerManagedMcpService({
  service: "caldav",
  label: "Mailbox (CalDav, IMAP, SMTP)",
  emoji: "📨",
  prefix: "caldav-",
  capabilityScope: "caldav.token",
  entryEnvVar: "FLATCLAW_CALDAV_MCP_ENTRY",
  description:
    "Mailbox-account access — CalDAV (calendar), CardDAV (contacts), IMAP (read), SMTP (send). Authenticated by email-account password (NOT a cPanel API token); each user owns their own slot.",
  // Tool inventory (mirrors mcp/caldav/src/tools/*). Per-user Tool Access
  // toggles → native tools.deny.
  toolGroups: [
    {
      id: "calendar",
      label: "Calendar (CalDAV)",
      description: "Calendars, events, invitations, free/busy.",
      tools: [
        "caldav_list_calendars", "caldav_list_events", "caldav_search_events",
        "caldav_create_event", "caldav_create_event_with_invite",
        "caldav_update_event", "caldav_delete_event",
        "caldav_respond_to_invitation", "caldav_freebusy",
      ],
    },
    {
      id: "contacts",
      label: "Contacts (CardDAV)",
      description: "Address books and contacts.",
      tools: [
        "carddav_list_address_books", "carddav_list_contacts",
        "carddav_search_contacts", "carddav_get_contact",
        "carddav_create_contact", "carddav_update_contact", "carddav_delete_contact",
      ],
    },
    {
      id: "mail-read",
      label: "Mail — read (IMAP)",
      description: "Mailboxes, search, read, threads, attachments, flags, foldering.",
      tools: [
        "imap_list_mailboxes", "imap_list_recent", "imap_search",
        "imap_read_message", "imap_thread", "imap_list_attachments",
        "imap_get_attachment", "imap_mark_read", "imap_mark_unread",
        "imap_set_flags", "imap_move", "imap_copy", "imap_archive",
        "imap_trash", "imap_delete", "imap_expunge", "imap_mailbox_create",
        "imap_mailbox_delete", "imap_mailbox_rename",
      ],
    },
    {
      id: "mail-send",
      label: "Mail — send (SMTP)",
      description: "Send, reply, forward, calendar invite/cancel.",
      tools: [
        "smtp_send", "smtp_reply", "smtp_forward",
        "smtp_send_calendar_invite", "smtp_send_calendar_cancel",
      ],
    },
  ],
  buildExtraEnv: () => {
    // Lane-based toolset gating. Prod (Gemma 4 31B, 128k+ context)
    // always gets `full` — never trim agent capabilities for the
    // production model. Dev (Gemma 4 E4B, 32k context) defaults to
    // `core` (~12 tools) so the prompt fits with room for conversation.
    // Override per-tenant via FLATCLAW_CALDAV_MCP_TOOLSET if needed.
    // Full toolset everywhere — A100 dev has KV room.
    const toolset = process.env.FLATCLAW_CALDAV_MCP_TOOLSET ?? "full";
    const mode = process.env.FLATCLAW_CALDAV_MCP_MODE ?? "verbose";
    return { CALDAV_MCP_TOOLSET: toolset, CALDAV_MCP_MODE: mode };
  },
  auth: {
    kind: "form",
    fields: [
      {
        name: "email",
        label: "Email address",
        placeholder: "keith@flatclaw.org",
        type: "text",
        required: true,
        help: "The email mailbox the agent will operate. Used for SMTP/IMAP/DAV auth.",
      },
      {
        name: "password",
        label: "Mailbox password",
        type: "secret",
        required: true,
        help: "The email-account password (NOT the cPanel root token). Set in cPanel → Email Accounts → Manage.",
      },
      {
        name: "davUrl",
        label: "CalDAV / CardDAV base URL",
        placeholder: "https://flatclaw.org:2080",
        type: "url",
        required: true,
        defaultValue: "https://flatclaw.org:2080",
        help: "cPanel's CCS server (default port 2080 over TLS).",
      },
      {
        name: "imapHost",
        label: "IMAP host",
        placeholder: "flatclaw.org",
        type: "text",
        defaultValue: "flatclaw.org",
      },
      {
        name: "imapPort",
        label: "IMAP port",
        type: "number",
        defaultValue: 993,
      },
      {
        name: "smtpHost",
        label: "SMTP host",
        placeholder: "flatclaw.org",
        type: "text",
        defaultValue: "flatclaw.org",
      },
      {
        name: "smtpPort",
        label: "SMTP port",
        type: "number",
        defaultValue: 465,
      },
    ],
  },
  async setCredential(userId, payload) {
    const email = String(payload.email ?? "").trim();
    const password = String(payload.password ?? "").trim();
    const davUrl = String(payload.davUrl ?? "").trim();
    if (!email || !password || !davUrl) {
      throw new Error("email, password, and davUrl are required");
    }
    await setCaldavCredential(userId, {
      email,
      password,
      davUrl,
      imapHost: payload.imapHost ? String(payload.imapHost).trim() : null,
      imapPort: payload.imapPort != null ? Number(payload.imapPort) : null,
      imapSecure:
        payload.imapSecure == null ? true : payload.imapSecure !== false,
      smtpHost: payload.smtpHost ? String(payload.smtpHost).trim() : null,
      smtpPort: payload.smtpPort != null ? Number(payload.smtpPort) : null,
      smtpSecure:
        payload.smtpSecure == null ? true : payload.smtpSecure !== false,
    });
  },
  async readStatus(userId): Promise<ManagedCredentialStatus> {
    const s = await readCaldavStatus(userId);
    return {
      connected: s.connected,
      identity: s.email ?? null,
      updatedAt: s.updatedAt ? s.updatedAt.getTime() : null,
      lastUsedAt: s.lastUsedAt ? s.lastUsedAt.getTime() : null,
      meta: {
        davUrl: s.davUrl,
        imapHost: s.imapHost,
        smtpHost: s.smtpHost,
      },
    };
  },
  async deleteCredential(userId) {
    await deleteCaldavCredential(userId);
  },
});
