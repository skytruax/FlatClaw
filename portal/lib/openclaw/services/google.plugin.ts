/**
 * Google MCP service plugin.
 *
 * OAuth-authenticated per-user Google access spanning Gmail, Calendar,
 * Drive, Docs, Sheets, Slides, Contacts, Tasks, People — anything the
 * `gog` CLI exposes. The plugin owns Google's code-exchange + refresh-
 * token flow; the generic OAuth router uses the descriptor's
 * `auth.exchangeCode` / `auth.refreshAccessToken` hooks.
 *
 * Token storage lives in `service_oauth_tokens` keyed on (userId, "google").
 * The capability-token bridge at `/api/internal/oauth/google/token` resolves
 * a presented capability token → user → fresh access token (refreshing if
 * needed) for the per-user `gog-<safeAgentId>` MCP wrapper, which is the
 * `gog` CLI invoked with `GOG_ACCESS_TOKEN` set per call.
 */
import {
  registerManagedMcpService,
  type ManagedCredentialStatus,
  type OauthTokenBundle,
} from "../managed-mcp";
import {
  readServiceOauthStatus,
  deleteServiceOauthToken,
} from "@/lib/credentials/oauth";

/**
 * Wide-open Google scopes — the per-user `gog` MCP wrapper covers every
 * surface, so we ask for every scope at consent. This trades extra consent
 * UI lines at sign-in for never having to send the user back to re-consent
 * when they pick a new sub-feature.
 */
const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  // Gmail
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  // Calendar
  "https://www.googleapis.com/auth/calendar",
  // Drive
  "https://www.googleapis.com/auth/drive",
  // Sheets, Docs, Slides
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/presentations",
  // Contacts / People
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/contacts.readonly",
  // Tasks
  "https://www.googleapis.com/auth/tasks",
];

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GoogleIdTokenPayload {
  email?: string;
  sub?: string;
}

function decodeIdTokenEmail(idToken: string): string | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(json) as GoogleIdTokenPayload;
    return payload.email ?? null;
  } catch {
    return null;
  }
}

async function googleTokenPost(
  body: Record<string, string>,
): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!res.ok || data.error) {
    throw new Error(
      `google token endpoint ${res.status}: ${data.error ?? "unknown"} ${data.error_description ?? ""}`.trim(),
    );
  }
  return data;
}

registerManagedMcpService({
  service: "google",
  label: "Google (Gmail, Calendar, Drive, Docs, Sheets, Contacts)",
  emoji: "🅖",
  prefix: "google-",
  capabilityScope: "google.token",
  entryEnvVar: "FLATCLAW_GOOGLE_MCP_ENTRY",
  description:
    "All Google services via direct REST — Gmail, Calendar, Drive, Docs, Sheets, Contacts. Single OAuth, per-user access token freshly issued per tool call. No CLI on the host.",
  // Tool inventory (mirrors mcp/google/src/tools/*). Per-user Tool Access
  // toggles → native tools.deny.
  toolGroups: [
    {
      id: "gmail",
      label: "Gmail",
      description: "Search, read, send, drafts, labels, threads, attachments.",
      tools: [
        "gmail_search", "gmail_get", "gmail_get_thread", "gmail_list_labels",
        "gmail_send", "gmail_create_draft", "gmail_list_drafts", "gmail_send_draft",
        "gmail_delete_draft", "gmail_modify", "gmail_batch_modify",
        "gmail_create_label", "gmail_trash", "gmail_untrash", "gmail_get_attachment",
      ],
    },
    {
      id: "calendar",
      label: "Calendar",
      description: "Events, invitations, free/busy.",
      tools: [
        "calendar_list_calendars", "calendar_events", "calendar_get_event",
        "calendar_create_event", "calendar_update_event", "calendar_delete_event",
        "calendar_respond", "calendar_freebusy",
      ],
    },
    {
      id: "drive",
      label: "Drive",
      description: "List, search, read, upload, organize, share files.",
      tools: [
        "drive_ls", "drive_search", "drive_get", "drive_download", "drive_upload",
        "drive_copy", "drive_move", "drive_rename", "drive_mkdir", "drive_trash",
        "drive_delete", "drive_share", "drive_unshare",
      ],
    },
    {
      id: "docs",
      label: "Docs",
      description: "Create, read, edit Google Docs.",
      tools: [
        "docs_create", "docs_get", "docs_get_raw", "docs_append",
        "docs_replace_all", "docs_batch_update",
      ],
    },
    {
      id: "sheets",
      label: "Sheets",
      description: "Create, read, update spreadsheets.",
      tools: [
        "sheets_create", "sheets_read", "sheets_update", "sheets_append",
        "sheets_clear", "sheets_add_tab", "sheets_batch_update", "sheets_get_metadata",
      ],
    },
    {
      id: "contacts",
      label: "Contacts",
      description: "List, search, manage contacts + directory.",
      tools: [
        "contacts_list", "contacts_search", "contacts_get", "contacts_create",
        "contacts_update", "contacts_delete", "contacts_me", "contacts_list_directory",
      ],
    },
  ],
  buildExtraEnv: () => {
    // Lane-based toolset gating. Prod (Gemma 4 31B, 128k+ context)
    // always gets `full` (58 tools) — never trim agent capabilities for
    // the production model. Dev (Gemma 4 E4B, 32k context) defaults to
    // `core` (~14 tools) so the prompt fits. Override per-tenant via
    // FLATCLAW_GOOGLE_MCP_TOOLSET.
    // Full toolset everywhere — A100 dev has KV room.
    const toolset = process.env.FLATCLAW_GOOGLE_MCP_TOOLSET ?? "full";
    const mode = process.env.FLATCLAW_GOOGLE_MCP_MODE ?? "verbose";
    return { GOOGLE_MCP_TOOLSET: toolset, GOOGLE_MCP_MODE: mode };
  },
  auth: {
    kind: "oauth",
    provider: "google",
    providerLabel: "Google",
    scopes: GOOGLE_SCOPES,
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    authorizationParams: {
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    },
    async exchangeCode(code, clientId, clientSecret, redirectUri): Promise<OauthTokenBundle> {
      const data = await googleTokenPost({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      });
      if (!data.access_token) {
        throw new Error("google token response missing access_token");
      }
      const expiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null;
      const identity = data.id_token ? decodeIdTokenEmail(data.id_token) : null;
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiresAt,
        scope: data.scope ?? null,
        identity,
      };
    },
    async refreshAccessToken(refreshToken, clientId, clientSecret): Promise<OauthTokenBundle> {
      const data = await googleTokenPost({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });
      if (!data.access_token) {
        throw new Error("google refresh response missing access_token");
      }
      const expiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null;
      // Google does NOT issue a new refresh_token on refresh; the caller is
      // expected to preserve the existing one. setServiceOauthToken treats
      // `refreshToken === undefined` as "preserve" so we omit it here.
      return {
        accessToken: data.access_token,
        expiresAt,
        scope: data.scope ?? null,
      };
    },
  },
  async readStatus(userId: string): Promise<ManagedCredentialStatus> {
    const s = await readServiceOauthStatus(userId, "google");
    return {
      connected: s.connected,
      identity: s.identity,
      updatedAt: s.updatedAt ? s.updatedAt.getTime() : null,
      lastUsedAt: null,
      meta: {
        scope: s.scope,
        expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
      },
    };
  },
  async deleteCredential(userId: string): Promise<void> {
    await deleteServiceOauthToken(userId, "google");
  },
});
