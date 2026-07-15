import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  unique,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  agentId: text("agent_id").unique(),
  identityName: text("identity_name"),
  identityEmoji: text("identity_emoji"),
  identityAvatar: text("identity_avatar"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
});

export const secrets = sqliteTable(
  "secrets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  },
  (t) => [unique("secrets_user_name").on(t.userId, t.name)],
);

export const oauthTokens = sqliteTable(
  "oauth_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["google"] }).notNull(),
    googleSub: text("google_sub"),
    // Per-token IV + authTag because each AES-GCM seal produces its own.
    accessTokenCipher: text("access_token_cipher").notNull(),
    accessIv: text("access_iv").notNull(),
    accessAuthTag: text("access_auth_tag").notNull(),
    refreshTokenCipher: text("refresh_token_cipher"),
    refreshIv: text("refresh_iv"),
    refreshAuthTag: text("refresh_auth_tag"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    email: text("email"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [unique("oauth_tokens_user_provider").on(t.userId, t.provider)],
);

export const cpanelCredentials = sqliteTable(
  "cpanel_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Plaintext metadata — never sensitive on its own.
    username: text("username").notNull(),
    serverUrl: text("server_url").notNull(),
    verifySsl: integer("verify_ssl", { mode: "boolean" }).notNull().default(true),
    // The cPanel API token is the only true secret here. AES-256-GCM with the
    // portal's PORTAL_SECRETS_KEY and an AAD that pins this row to its scope
    // (see lib/credentials/cpanel.ts).
    apiTokenCipher: text("api_token_cipher").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  },
  (t) => [unique("cpanel_credentials_user").on(t.userId)],
);

export const jiraCredentials = sqliteTable(
  "jira_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Plaintext metadata — not sensitive on its own.
    // The Atlassian account email + the workspace URL the user generated
    // the API token under (e.g. https://kirktechsolutions.atlassian.net).
    email: text("email").notNull(),
    workspaceUrl: text("workspace_url").notNull(),
    // Atlassian API token. Cloud uses HTTP Basic with `<email>:<token>`
    // — the token alone is the secret, paired with the email at request
    // time. AES-256-GCM sealed with PORTAL_SECRETS_KEY; AAD pins each
    // row to (userId, "jira-credentials").
    apiTokenCipher: text("api_token_cipher").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  },
  (t) => [unique("jira_credentials_user").on(t.userId)],
);

export const caldavCredentials = sqliteTable(
  "caldav_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Plaintext metadata — not sensitive on its own.
    email: text("email").notNull(),
    davUrl: text("dav_url").notNull(),
    imapHost: text("imap_host"),
    imapPort: integer("imap_port"),
    imapSecure: integer("imap_secure", { mode: "boolean" }),
    smtpHost: text("smtp_host"),
    smtpPort: integer("smtp_port"),
    smtpSecure: integer("smtp_secure", { mode: "boolean" }),
    // The mailbox-account password is the only true secret. AES-256-GCM
    // sealed with PORTAL_SECRETS_KEY; AAD pins each row to (userId, scope).
    passwordCipher: text("password_cipher").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  },
  (t) => [unique("caldav_credentials_user").on(t.userId)],
);

/**
 * Generic per-(user, service) credential vault. Replaces the bespoke
 * per-service credential tables with one shape every managed
 * MCP service can use — so adding a service (public or private) needs no new
 * table, and the public schema carries no private-service-specific columns.
 *
 *   - `data`     — JSON of non-secret metadata the service needs (username,
 *                  server URL, role, vertical, host/port, …). Service-defined.
 *   - secret*    — optional AES-256-GCM sealed secret (api token / password).
 *                  Null for services with no secret (e.g. a demo role tuple).
 *                  Sealed with PORTAL_SECRETS_KEY; AAD pins (userId, service).
 */
export const serviceCredentials = sqliteTable(
  "service_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    service: text("service").notNull(),
    data: text("data", { mode: "json" }),
    secretCipher: text("secret_cipher"),
    secretIv: text("secret_iv"),
    secretAuthTag: text("secret_auth_tag"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  },
  (t) => [unique("service_credentials_user_service").on(t.userId, t.service)],
);

/**
 * Generic per-(service, role, tool-group) enable matrix. Any service can
 * declare tool groups and
 * have a tenant-admin matrix gate them per role. The service's plugin reads
 * the rows for the connected user's role and emits the enabled-group set into
 * the MCP's env. (RBAC invocation-time enforcement layers on top of this.)
 */
export const serviceToolGroupPolicy = sqliteTable(
  "service_tool_group_policy",
  {
    id: text("id").primaryKey(),
    service: text("service").notNull(),
    role: text("role").notNull(),
    groupId: text("group_id").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    unique("service_tool_group_policy_svc_role_group").on(
      t.service,
      t.role,
      t.groupId,
    ),
  ],
);

/**
 * Tenant-level enable/disable per managed service. The dispatcher consults
 * this table whenever it provisions a per-user MCP — service must be
 * enabled here AND the user must have credentials in their vault for the
 * MCP to be registered in openclaw config. Updated only by admins.
 */
export const serviceSettings = sqliteTable("service_settings", {
  service: text("service").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  // UI-only visibility flag (separate from `enabled`). When true the service's
  // connection card is hidden from the per-user connections panel — used to
  // simplify a demo without disabling/deprovisioning the service. Toggled from
  // the admin Settings page; does NOT touch provisioning.
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/**
 * Tenant-level allowlist for openclaw OOTB skills. Default-deny: a skill is
 * only visible to any agent if it has a row here with `enabled = true`.
 *
 * Enforced via per-agent allowlist (`agents.list[i].skills` in
 * openclaw config), NOT by writing `skills.entries.<name>.enabled = false`
 * globally. That keeps openclaw config minimal and lets us layer Cedar
 * policies on top later without competing with explicit-disable writes.
 */
export const tenantSkillSettings = sqliteTable("tenant_skill_settings", {
  skill: text("skill").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/**
 * Per-(user, service) OAuth tokens. Replaces the legacy `oauth_tokens` table
 * which was hardcoded to provider="google". Each service plugin (gmail,
 * slack, notion, jira, hubspot, github-oauth, ...) writes its tokens here
 * and reads them back via lib/credentials/oauth.ts.
 *
 * The plain `service` column matches the plugin's `service` id (managed-mcp
 * descriptor). `identity` carries provider-specific account info (gmail
 * email, slack workspace, jira cloud id) for display in the admin UI.
 */
export const serviceOauthTokens = sqliteTable(
  "service_oauth_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    service: text("service").notNull(),
    identity: text("identity"),
    accessTokenCipher: text("access_token_cipher").notNull(),
    accessIv: text("access_iv").notNull(),
    accessAuthTag: text("access_auth_tag").notNull(),
    refreshTokenCipher: text("refresh_token_cipher"),
    refreshIv: text("refresh_iv"),
    refreshAuthTag: text("refresh_auth_tag"),
    scope: text("scope"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [unique("service_oauth_tokens_user_service").on(t.userId, t.service)],
);

/**
 * Per-tenant OAuth-app config. Each service plugin that uses the OAuth
 * flow needs a client_id + client_secret + redirect_uri configured ONCE
 * by the tenant admin (not per-user). Replaces the Google-only
 * `oauth_app_config` singleton.
 */
export const serviceOauthApps = sqliteTable("service_oauth_apps", {
  service: text("service").primaryKey(),
  clientId: text("client_id").notNull(),
  clientSecretCipher: text("client_secret_cipher").notNull(),
  clientSecretIv: text("client_secret_iv").notNull(),
  clientSecretAuthTag: text("client_secret_auth_tag").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const oauthAppConfig = sqliteTable("oauth_app_config", {
  id: integer("id").primaryKey(),
  googleClientId: text("google_client_id"),
  googleClientSecretCipher: text("google_client_secret_cipher"),
  iv: text("iv"),
  authTag: text("auth_tag"),
  redirectUri: text("redirect_uri"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const agentCapabilities = sqliteTable(
  "agent_capabilities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    capabilityToken: text("capability_token").notNull().unique(),
    scope: text("scope").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (t) => [unique("agent_capabilities_user_scope").on(t.userId, t.scope)],
);

export const sessionsMeta = sqliteTable(
  "sessions_meta",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    openclawSessionKey: text("openclaw_session_key").notNull(),
    title: text("title"),
    lastMessageAt: integer("last_message_at", { mode: "timestamp_ms" }),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("sessions_meta_user_recent").on(t.userId, t.lastMessageAt)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    targetUserId: text("target_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    metadata: text("metadata", { mode: "json" }),
    ts: integer("ts", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("audit_log_actor_ts").on(t.actorUserId, t.ts)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Secret = typeof secrets.$inferSelect;
export type OAuthToken = typeof oauthTokens.$inferSelect;
export type AgentCapability = typeof agentCapabilities.$inferSelect;
export type SessionMeta = typeof sessionsMeta.$inferSelect;
export type CpanelCredential = typeof cpanelCredentials.$inferSelect;
export type NewCpanelCredential = typeof cpanelCredentials.$inferInsert;
export type CaldavCredential = typeof caldavCredentials.$inferSelect;
export type NewCaldavCredential = typeof caldavCredentials.$inferInsert;
export type JiraCredential = typeof jiraCredentials.$inferSelect;
export type NewJiraCredential = typeof jiraCredentials.$inferInsert;
export type ServiceOauthToken = typeof serviceOauthTokens.$inferSelect;
export type NewServiceOauthToken = typeof serviceOauthTokens.$inferInsert;
export type ServiceOauthApp = typeof serviceOauthApps.$inferSelect;
export type NewServiceOauthApp = typeof serviceOauthApps.$inferInsert;
