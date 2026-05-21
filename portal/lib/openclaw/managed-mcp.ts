/**
 * Plugin layer for "managed" MCP services — services where each FlatClaw user
 * gets their own per-user MCP server registration in openclaw, gated by RBAC
 * deny-list, fed by the capability-token bridge.
 *
 * Adding a new service (slack, notion, jira, …) is one descriptor, registered
 * by importing its plugin file. The generic `provisionManagedMcpForUser` and
 * `deprovisionManagedMcpForUser` functions below handle everything else:
 *
 *   - mint capability token (scope = `<service>.token`)
 *   - register `mcp.servers.<prefix><safeAgentId>` with the right env
 *   - recompute every agent's tool deny list so isolation holds
 *   - revoke + clean up on deprovision
 *
 * Per-service code that doesn't generalize (DB schema, bridge endpoint shape)
 * lives next to its descriptor. Everything that generalizes lives here.
 */

import { getGatewayClient } from "./adapter";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import {
  ensureCapabilityToken,
  revokeCapabilityToken,
  type CapabilityScope,
} from "@/lib/oauth/capability-tokens";
import {
  applyManagedToolPolicies,
  safeAgentId,
  registerManagedPrefix,
} from "./agent-tool-policy";

interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  [k: string]: unknown;
}

interface ConfigBlob {
  agents?: { list?: Array<{ id?: string; [k: string]: unknown }>; [k: string]: unknown };
  mcp?: { servers?: Record<string, McpServerEntry>; [k: string]: unknown };
  [k: string]: unknown;
}

interface ConfigGetResult {
  config: ConfigBlob | string;
  hash?: string;
  baseHash?: string;
  raw?: string;
}

function readBlob(value: unknown): ConfigBlob {
  if (typeof value === "string") return JSON.parse(value) as ConfigBlob;
  return (value as ConfigBlob) ?? {};
}

/**
 * A named set of MCP tools a service exposes. Used purely as a tool inventory:
 * the admin per-user Tool Access panel lists these tools as allow/deny toggles
 * (written to the agent's native `tools.deny`). There is no separate policy
 * store — OpenClaw's built-in tool policy is the enforcement layer.
 */
export interface ToolGroupDescriptor {
  id: string;
  label: string;
  description: string;
  tools: readonly string[];
}

/**
 * Field declaration for a service's credential form. The admin UI iterates
 * `auth.fields` (when `auth.kind === "form"`) to render the per-service
 * "Connect" form generically —
 * adding a new service is one plugin file, no UI code change.
 */
export interface CredentialFieldSpec {
  /** Form field name. Becomes the key in the payload posted to setCredential. */
  name: string;
  /** Human-readable label. */
  label: string;
  /** Placeholder text shown in the input. */
  placeholder?: string;
  /** Field type. `secret` is masked + autocomplete=off. */
  type: "text" | "secret" | "url" | "number" | "boolean";
  /** Whether the field is required. Defaults true. */
  required?: boolean;
  /** Default value pre-filled in the form. */
  defaultValue?: string | number | boolean;
  /** Hint text shown below the field. */
  help?: string;
}

/**
 * Status report for a single (service, userId) pair, returned to the admin UI.
 * Common shape across all services so the UI can render a unified status badge
 * regardless of which service it's looking at.
 */
export interface ManagedCredentialStatus {
  connected: boolean;
  /** Display string shown next to the connection ("connected as alice@…"). */
  identity?: string | null;
  /** Last update timestamp (millis since epoch). */
  updatedAt?: number | null;
  /** Last successful read timestamp. */
  lastUsedAt?: number | null;
  /** Free-form metadata the UI may render in a status row. */
  meta?: Record<string, string | number | boolean | null>;
}

/**
 * Token bundle returned by an OAuth provider. Plugin's `exchangeCode` and
 * `refreshAccessToken` hooks return this shape; the generic OAuth router
 * persists it via `setServiceOauthToken`.
 */
export interface OauthTokenBundle {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scope?: string | null;
  /** Provider account label shown in admin UI (gmail email, slack workspace). */
  identity?: string | null;
}

/**
 * Discriminated auth shape per service plugin.
 *
 *   - `form` — paste-creds form rendered from the field spec; user-side
 *     vault writes go through the plugin's `setCredential` hook.
 *   - `oauth` — provider OAuth flow; tenant admin sets up the OAuth app
 *     once, users authorize via the generic OAuth routes. Plugin owns
 *     the provider-specific code-exchange + refresh logic.
 */
export type ManagedMcpAuth =
  | { kind: "form"; fields: CredentialFieldSpec[] }
  | {
      kind: "oauth";
      /** Provider id used by the admin UI to label the OAuth-app form. */
      provider: string;
      /** Display name of the provider for the Connect button. */
      providerLabel: string;
      /** Default scopes requested when redirecting to the provider. */
      scopes: string[];
      /**
       * Provider's authorization endpoint. The generic /oauth/start
       * route appends `client_id`, `redirect_uri`, `state`, `scope`,
       * `response_type=code`, plus any extra params.
       */
      authorizationUrl: string;
      /** Extra query params to add to the authorization URL (e.g. `prompt: "consent"`, `access_type: "offline"`). */
      authorizationParams?: Record<string, string>;
      /**
       * Plugin-owned code → token exchange. Receives the exact code +
       * redirect URI it must round-trip with (per OAuth 2.1 spec).
       */
      exchangeCode: (
        code: string,
        clientId: string,
        clientSecret: string,
        redirectUri: string,
      ) => Promise<OauthTokenBundle>;
      /**
       * Plugin-owned refresh-token flow. Returns a fresh access token (and
       * possibly an updated bundle if the provider rotates refresh tokens).
       * Called by the per-service /api/internal/<svc>-token bridge when the
       * cached access token has < ~60s left.
       */
      refreshAccessToken?: (
        refreshToken: string,
        clientId: string,
        clientSecret: string,
      ) => Promise<OauthTokenBundle>;
    };

/** Context passed to a service's prompt-section hooks. */
export interface ServicePromptContext {
  userId: string;
  agentId: string;
  /** This user's per-user MCP server name, e.g. `cpanel-<safeAgentId>`. */
  serverName: string;
}

/** One row in the registry. New services append here (or via plugin file). */
export interface ManagedMcpService {
  /** Stable id used in audit, env, capability scope: e.g. `cpanel`. */
  service: string;
  /** Display name in admin UI: e.g. "cPanel hosting account". */
  label: string;
  /** Short emoji shown as the icon in admin UI tiles. */
  emoji?: string;
  /** Server-name prefix in `mcp.servers.<prefix><safeAgentId>`: e.g. `cpanel-`. */
  prefix: string;
  /** Capability-token scope name: e.g. `cpanel.token`. */
  capabilityScope: CapabilityScope;
  /** Env var pointing at the built MCP entrypoint (`node <path>`). */
  entryEnvVar: string;
  /** One-line description used in admin UI / audit. */
  description: string;
  /** How the user authenticates to this service. */
  auth: ManagedMcpAuth;
  /**
   * Optional tool inventory: named groups of the tools this service exposes.
   * Surfaced in the admin per-user Tool Access panel as allow/deny toggles
   * (written to the agent's native `tools.deny`). Enforcement is OpenClaw's
   * built-in tool policy — no separate policy store.
   */
  toolGroups?: readonly ToolGroupDescriptor[];
  /**
   * Optional per-service prompt sections. When the user has this service
   * connected, `sync-skills` calls these to fold a service-specific bullet
   * into the agent's AGENTS.md / TOOLS.md — so a private add-on service can
   * describe its own tools without the upstream prompt builder naming it.
   * Return null to contribute nothing (e.g. not connected). Skipped in
   * subagent mode (each subagent gets its own service's schemas directly).
   */
  buildAgentsSection?: (ctx: ServicePromptContext) => Promise<string | null>;
  buildToolsSection?: (ctx: ServicePromptContext) => Promise<string | null>;
  /**
   * Optional extra env injected into the spawned MCP process beyond the
   * standard `CAPABILITY_TOKEN` + `PORTAL_BASE_URL` pair. Example: cpanel's
   * `CPANEL_MCP_TOOLSET=core|full` lane gate.
   */
  buildExtraEnv?: () => Record<string, string>;
  /**
   * Persist a credential payload to the vault. Required only for
   * `auth.kind === "form"` plugins (the generic OAuth router writes
   * tokens directly via lib/credentials/oauth.ts).
   */
  setCredential?: (
    userId: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  /** Read connection status for the admin UI. Cheap; called on every page render. */
  readStatus: (userId: string) => Promise<ManagedCredentialStatus>;
  /** Tear down the vault row. Called from the disconnect button + audit. */
  deleteCredential: (userId: string) => Promise<void>;
}

const REGISTRY = new Map<string, ManagedMcpService>();

export function registerManagedMcpService(svc: ManagedMcpService): void {
  // Register this service's MCP server-name prefix so cross-user RBAC can
  // synthesise the `<prefix><safeAgentId>__*` deny pattern that hides it from
  // other agents. The registry — not a hardcoded list — is the source of
  // truth, so public and private (add-on) services self-register identically
  // and the upstream code references no specific service.
  registerManagedPrefix(svc.prefix);
  if (REGISTRY.has(svc.service)) {
    // Idempotent re-registration: same shape, no warning. Different shape,
    // last-wins with a warning so dev doesn't get silently divergent
    // behavior between hot-reloads.
    const prev = REGISTRY.get(svc.service)!;
    if (JSON.stringify(prev) !== JSON.stringify(svc)) {
      console.warn(
        `[managed-mcp] re-registering "${svc.service}" with a different descriptor — last write wins.`,
      );
    }
  }
  REGISTRY.set(svc.service, svc);
}

export function getManagedMcpService(name: string): ManagedMcpService | undefined {
  return REGISTRY.get(name);
}

export function listManagedMcpServices(): ManagedMcpService[] {
  return Array.from(REGISTRY.values()).sort((a, b) => a.service.localeCompare(b.service));
}

/**
 * Compose the per-user MCP server name for a given service + agent. Single
 * source of truth — same shape used by `agent-tool-policy.ts`.
 */
export function managedMcpServerName(svc: ManagedMcpService, agentId: string): string {
  return `${svc.prefix}${safeAgentId(agentId)}`;
}

export interface ManagedMcpProvisionResult {
  service: string;
  serverName: string;
  capabilityToken: string;
}

/**
 * Idempotently registers `mcp.servers.<prefix><safeAgentId>` for the given
 * (service, userId), mints (or reuses) the capability token, and recomputes
 * RBAC deny lists. Skips the gateway round-trip when nothing actually changes.
 */
export async function provisionManagedMcpForUser(
  service: string,
  userId: string,
): Promise<ManagedMcpProvisionResult | null> {
  const svc = REGISTRY.get(service);
  if (!svc) {
    throw new Error(
      `unknown managed MCP service "${service}" — register it via lib/openclaw/services/<svc>.plugin.ts before calling provision`,
    );
  }
  const userRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (userRows.length === 0 || !userRows[0].agentId) return null;
  const u = userRows[0];

  const mcpEntry = process.env[svc.entryEnvVar];
  if (!mcpEntry) {
    throw new Error(
      `${svc.entryEnvVar} missing — point it at the built ${svc.service} MCP entrypoint`,
    );
  }
  const portalBase = process.env.FLATCLAW_PORTAL_BASE_URL ?? "http://127.0.0.1:3000";

  const capToken = await ensureCapabilityToken(userId, svc.capabilityScope);
  const serverName = managedMcpServerName(svc, u.agentId!);
  const extraEnv = svc.buildExtraEnv ? svc.buildExtraEnv() : {};
  // Tools that need to write directly into the agent's workspace
  // (e.g. cpanel download_file, drive_download) read these to derive the
  // path without round-tripping the file content through the model.
  const workspacePath = `${process.env.HOME ?? "/home/sky"}/.openclaw/workspace-${u.agentId!}`;
  const desired: McpServerEntry = {
    command: "node",
    args: [mcpEntry],
    env: {
      CAPABILITY_TOKEN: capToken,
      PORTAL_BASE_URL: portalBase,
      OPENCLAW_AGENT_ID: u.agentId!,
      OPENCLAW_WORKSPACE_PATH: workspacePath,
      ...extraEnv,
    },
  };

  const client = getGatewayClient();
  const cur = (await client.call("config.get", {})) as ConfigGetResult;
  const blob = readBlob(cur.config ?? cur.raw);
  const before = JSON.stringify(blob);

  blob.mcp = blob.mcp ?? {};
  blob.mcp.servers = blob.mcp.servers ?? {};
  blob.mcp.servers[serverName] = desired;

  applyManagedToolPolicies(blob);

  const after = JSON.stringify(blob);
  if (after === before) {
    return { service: svc.service, serverName, capabilityToken: capToken };
  }
  await client.call("config.set", { raw: after, baseHash: cur.hash ?? cur.baseHash });
  await client.waitUntilReady();
  return { service: svc.service, serverName, capabilityToken: capToken };
}

export async function deprovisionManagedMcpForUser(
  service: string,
  userId: string,
): Promise<void> {
  const svc = REGISTRY.get(service);
  if (!svc) return;
  const userRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (userRows.length === 0 || !userRows[0].agentId) return;
  const serverName = managedMcpServerName(svc, userRows[0].agentId!);

  const client = getGatewayClient();
  const cur = (await client.call("config.get", {})) as ConfigGetResult;
  const blob = readBlob(cur.config ?? cur.raw);
  const before = JSON.stringify(blob);

  if (blob.mcp?.servers?.[serverName]) {
    delete blob.mcp.servers[serverName];
    if (Object.keys(blob.mcp.servers).length === 0) delete blob.mcp.servers;
    if (blob.mcp && Object.keys(blob.mcp).length === 0) delete blob.mcp;
  }
  applyManagedToolPolicies(blob);

  const after = JSON.stringify(blob);
  if (after !== before) {
    await client.call("config.set", { raw: after, baseHash: cur.hash ?? cur.baseHash });
    await client.waitUntilReady();
  }
  await revokeCapabilityToken(userId, svc.capabilityScope);
}

/**
 * Recomputes deny lists from the current openclaw config. Used as a repair
 * entry-point when the operator manually edits the config and wants RBAC
 * resynced.
 */
export async function recomputeAgentToolPolicies(): Promise<{
  changedAgents: string[];
}> {
  const client = getGatewayClient();
  const cur = (await client.call("config.get", {})) as ConfigGetResult;
  const blob = readBlob(cur.config ?? cur.raw);
  const before = JSON.stringify(blob);
  const result = applyManagedToolPolicies(blob);
  const after = JSON.stringify(blob);
  if (after === before) return result;
  await client.call("config.set", { raw: after, baseHash: cur.hash ?? cur.baseHash });
  await client.waitUntilReady();
  return result;
}

/**
 * Tenant-level enable/disable for a managed service. Reads/writes the
 * `service_settings` table. Default = false (services are off until an
 * admin explicitly enables them).
 *
 * The provision/deprovision loop is callers' responsibility — see
 * `setServiceEnabled` below for the wrapper that handles toggle + sync
 * atomically.
 */
export async function isServiceEnabled(service: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(schema.serviceSettings)
    .where(eq(schema.serviceSettings.service, service))
    .limit(1);
  return rows.length > 0 ? rows[0].enabled === true : false;
}

async function writeServiceEnabled(
  service: string,
  enabled: boolean,
): Promise<void> {
  const existing = await db
    .select()
    .from(schema.serviceSettings)
    .where(eq(schema.serviceSettings.service, service))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(schema.serviceSettings).values({
      service,
      enabled,
      updatedAt: new Date(),
    });
  } else {
    await db
      .update(schema.serviceSettings)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(schema.serviceSettings.service, service));
  }
}

/**
 * Sync result — caller-friendly summary of which agents got
 * provisioned vs deprovisioned in this round.
 */
export interface ServiceSyncResult {
  service: string;
  provisioned: string[]; // userIds
  deprovisioned: string[]; // userIds
  skipped: Array<{ userId: string; reason: string }>;
}

/**
 * Walks all users and, for the given service, ensures every user is in the
 * correct provisioning state:
 *
 *   - service enabled AND user has creds → provisioned
 *   - otherwise → deprovisioned
 *
 * Used after the admin toggles a service enable/disable, after a plugin is
 * registered (for catch-up), or as a manual repair.
 */
export async function syncManagedMcpForAllUsers(
  service: string,
): Promise<ServiceSyncResult> {
  const svc = REGISTRY.get(service);
  if (!svc) throw new Error(`unknown service "${service}"`);

  const enabled = await isServiceEnabled(service);
  const result: ServiceSyncResult = {
    service,
    provisioned: [],
    deprovisioned: [],
    skipped: [],
  };

  const allUsers = await db.select().from(schema.users);
  for (const u of allUsers) {
    if (!u.agentId) {
      result.skipped.push({ userId: u.id, reason: "no agent" });
      continue;
    }
    let hasCreds = false;
    try {
      const status = await svc.readStatus(u.id);
      hasCreds = status.connected === true;
    } catch (err) {
      result.skipped.push({
        userId: u.id,
        reason: `status read failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const shouldBeUp = enabled && hasCreds;
    if (shouldBeUp) {
      try {
        await provisionManagedMcpForUser(service, u.id);
        result.provisioned.push(u.id);
      } catch (err) {
        result.skipped.push({
          userId: u.id,
          reason: `provision failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } else {
      try {
        await deprovisionManagedMcpForUser(service, u.id);
        result.deprovisioned.push(u.id);
      } catch (err) {
        result.skipped.push({
          userId: u.id,
          reason: `deprovision failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }
  return result;
}

/**
 * Walks all registered services for a single user and brings each one to
 * the correct state. Called after a user is provisioned (no creds yet, so
 * usually a no-op) and after major credential changes.
 */
export async function syncAllManagedMcpsForUser(
  userId: string,
): Promise<Record<string, "provisioned" | "deprovisioned" | "skipped">> {
  const out: Record<string, "provisioned" | "deprovisioned" | "skipped"> = {};
  for (const svc of listManagedMcpServices()) {
    const enabled = await isServiceEnabled(svc.service);
    let hasCreds = false;
    try {
      hasCreds = (await svc.readStatus(userId)).connected === true;
    } catch (err) {
      console.error(
        `[managed-mcp] readStatus(${svc.service}, ${userId}) failed:`,
        err,
      );
      out[svc.service] = "skipped";
      continue;
    }
    const shouldBeUp = enabled && hasCreds;
    try {
      if (shouldBeUp) {
        await provisionManagedMcpForUser(svc.service, userId);
        out[svc.service] = "provisioned";
      } else {
        await deprovisionManagedMcpForUser(svc.service, userId);
        out[svc.service] = "deprovisioned";
      }
    } catch (err) {
      console.error(
        `[managed-mcp] ${shouldBeUp ? "provision" : "deprovision"}(${svc.service}, ${userId}) failed:`,
        err,
      );
      out[svc.service] = "skipped";
    }
  }
  return out;
}

/**
 * Atomic flip: write the tenant-level enable flag, then sync all users.
 * Returns the per-user sync result so the admin UI can show what changed.
 */
export async function setServiceEnabled(
  service: string,
  enabled: boolean,
): Promise<ServiceSyncResult> {
  const svc = REGISTRY.get(service);
  if (!svc) throw new Error(`unknown service "${service}"`);
  await writeServiceEnabled(service, enabled);
  return await syncManagedMcpForAllUsers(service);
}
