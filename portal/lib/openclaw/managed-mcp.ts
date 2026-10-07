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

import fs from "node:fs";
import path from "node:path";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import {
  ensureCapabilityToken,
  revokeCapabilityToken,
  type CapabilityScope,
} from "@/lib/oauth/capability-tokens";
import {
  applyManagedToolPolicies,
  gatewayToolName,
  legacyManagedServerName,
  legacyManagedServerNames,
  managedServerName,
  registerManagedPrefix,
} from "./agent-tool-policy";
import type { McpServerEntry } from "./agent-roster";
import {
  readGatewayConfig,
  storedMcpServerEntryEquals,
  writeGatewayConfig,
} from "./gateway-config";
import { gatewayMode, workspacePathFor } from "@/lib/gateways/paths";
import { adoptIntoWorkspace } from "@/lib/gateways/ownership";
import { gatewayClientFor, listGatewayHandles } from "@/lib/gateways/registry";

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
  /** Env var pointing at the built MCP entrypoint (`node <path>`). Required
   *  for stdio services; omit when `remote` is set. */
  entryEnvVar?: string;
  /**
   * Remote MCP endpoint (openclaw's native url transport) instead of a local
   * stdio spawn. The gateway connects straight to the URL; `tokenEnvVar` (if
   * set and present in env) is sent as an Authorization: Bearer header.
   * Network-level allowlisting (e.g. the peer accepting only the tenant's
   * egress IP) is the baseline auth for demo integrations.
   */
  remote?: {
    urlEnvVar: string;
    tokenEnvVar?: string;
    transport?: "streamable-http" | "sse";
  };
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
   * Optional per-role tool-access policy. Returns the `toolGroups` ids this
   * user's role should NOT have. Seeded into the agent's native `tools.deny`
   * at provision and on every sync, so role-appropriate tool availability is
   * automatic — an admin never has to hand-untick a restricted role's tools. The
   * MCP still role-gates returned DATA regardless of which tools are exposed.
   * Requires `toolGroups`. Return [] for a role that gets everything.
   */
  roleDeniedGroups?: (userId: string) => Promise<string[]>;
  /**
   * Optional skill directories to seed into a connected user's agent workspace
   * (`<workspace>/skills/<name>/`). Returns absolute source dirs; each is copied
   * recursively on provision and every sync (idempotent). Lets a service ship a
   * bundled skill (e.g. a doc-fill helper) that its agents can run locally.
   */
  workspaceSkills?: () => readonly string[];
  /**
   * Optional per-service prompt sections. When the user has this service
   * connected, `sync-skills` calls these to fold a service-specific bullet
   * into the agent's AGENTS.md (context and tool guide) — so a private add-on service can
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
   * Optional execution hook for the human-approval queue. When an approval
   * for THIS service is approved, the queue calls this with the action `kind`
   * and the `composedRequest` the tool returned, and the service performs the
   * real effect (e.g. apply the transfer / open the loan in its data store)
   * and returns a short human summary. Absence = approve records the sign-off
   * only (and a service detached from the build simply can't execute — the
   * queue degrades gracefully). Never called on deny.
   */
  executeApproval?: (input: {
    kind: string;
    composedRequest: unknown;
    /**
     * Agent that composed the request, derived by the queue from the session
     * the pending item was found in (never from envelope content). Services
     * with per-user credentials use this to act as the requesting user.
     */
    requestedByAgentId?: string;
    /** Display name (or email) of the person who clicked Approve, for write-backs that record who signed off. */
    approverName?: string;
  }) => Promise<{ summary: string } | null>;
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
 * source of truth — `managedServerName` in `agent-tool-policy.ts`, which keeps
 * the name within the 30 characters the gateway uses for tool names.
 */
export function managedMcpServerName(svc: ManagedMcpService, agentId: string): string {
  return managedServerName(svc.prefix, agentId);
}

export interface ManagedMcpProvisionResult {
  service: string;
  serverName: string;
  capabilityToken: string | null;
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

  const serverName = managedMcpServerName(svc, u.agentId!);

  // Seed any bundled workspace skills into the agent's workspace (idempotent).
  if (typeof svc.workspaceSkills === "function") {
    const workspaceRoot = workspacePathFor(u.agentId!);
    for (const sourceDir of svc.workspaceSkills()) {
      try {
        if (!fs.existsSync(sourceDir)) continue;
        const dest = path.join(workspaceRoot, "skills", path.basename(sourceDir));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.cpSync(sourceDir, dest, { recursive: true });
        // Written by the portal; the agent's own account must be able to change it.
        await adoptIntoWorkspace(u.agentId!, path.dirname(dest), { recursive: true });
      } catch (err) {
        console.warn(`[managed-mcp] skill seed ${sourceDir} → ${u.agentId} failed:`, err);
      }
    }
  }

  let desired: McpServerEntry;
  let capToken: string | null = null;
  if (svc.remote) {
    const url = process.env[svc.remote.urlEnvVar];
    if (!url) {
      throw new Error(
        `${svc.remote.urlEnvVar} missing — set the ${svc.service} remote MCP endpoint URL`,
      );
    }
    const token = svc.remote.tokenEnvVar ? process.env[svc.remote.tokenEnvVar] : undefined;
    desired = {
      url,
      transport: svc.remote.transport ?? "streamable-http",
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    };
  } else {
    const mcpEntry = svc.entryEnvVar ? process.env[svc.entryEnvVar] : undefined;
    if (!mcpEntry) {
      throw new Error(
        `${svc.entryEnvVar ?? "(entryEnvVar unset)"} missing — point it at the built ${svc.service} MCP entrypoint`,
      );
    }
    const portalBase = process.env.FLATCLAW_PORTAL_BASE_URL ?? "http://127.0.0.1:3000";
    capToken = await ensureCapabilityToken(userId, svc.capabilityScope);
    const extraEnv = svc.buildExtraEnv ? svc.buildExtraEnv() : {};
    // Tools that need to write directly into the agent's workspace
    // (e.g. cpanel download_file, drive_download) read these to derive the
    // path without round-tripping the file content through the model.
    const workspacePath = workspacePathFor(u.agentId!);
    desired = {
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
  }

  const client = await gatewayClientFor(u.agentId!);
  const snapshot = await readGatewayConfig(client);
  const { blob } = snapshot;

  blob.mcp = blob.mcp ?? {};
  blob.mcp.servers = blob.mcp.servers ?? {};
  // An entry registered before server names were capped at 30 characters
  // lives under the agent's full-length name; this registration replaces it.
  const legacyName = legacyManagedServerName(svc.prefix, u.agentId!);
  if (legacyName !== serverName) delete blob.mcp.servers[legacyName];
  // The entry read back from the gateway has its `env` / `headers` values
  // redacted, so it never compares equal to `desired` even when nothing
  // changed. Leave an already-correct entry untouched (the gateway restores
  // the redacted values on write) — otherwise every sync would rewrite the
  // config and reload the gateway, aborting whatever runs are in flight.
  if (
    !blob.mcp.servers[serverName] ||
    !storedMcpServerEntryEquals(serverName, desired)
  ) {
    blob.mcp.servers[serverName] = desired;
  }

  applyManagedToolPolicies(blob);

  await writeGatewayConfig(snapshot, client);
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
  const legacyName = legacyManagedServerName(svc.prefix, userRows[0].agentId!);

  const client = await gatewayClientFor(userRows[0].agentId!);
  const snapshot = await readGatewayConfig(client);
  const { blob } = snapshot;

  if (blob.mcp?.servers) {
    delete blob.mcp.servers[serverName];
    delete blob.mcp.servers[legacyName];
    if (Object.keys(blob.mcp.servers).length === 0) delete blob.mcp.servers;
    if (Object.keys(blob.mcp).length === 0) delete blob.mcp;
  }
  applyManagedToolPolicies(blob);

  await writeGatewayConfig(snapshot, client);
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
  const changedAgents: string[] = [];
  for (const handle of await listGatewayHandles()) {
    const snapshot = await readGatewayConfig(handle.client);
    const result = applyManagedToolPolicies(snapshot.blob);
    await writeGatewayConfig(snapshot, handle.client);
    changedAgents.push(...result.changedAgents);
  }
  return { changedAgents };
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

/**
 * UI-only visibility (separate from `enabled`). A hidden service is omitted
 * from the per-user connections panel so a demo stays simple — it does NOT
 * deprovision or disable anything. Toggled from the admin Settings page.
 */
export async function isServiceHidden(service: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(schema.serviceSettings)
    .where(eq(schema.serviceSettings.service, service))
    .limit(1);
  return rows.length > 0 ? rows[0].hidden === true : false;
}

/** Set of service ids currently hidden from the connections UI. */
export async function getHiddenServices(): Promise<Set<string>> {
  const rows = await db.select().from(schema.serviceSettings);
  return new Set(rows.filter((r) => r.hidden === true).map((r) => r.service));
}

/** Toggle a service's UI visibility. No provisioning side effects. */
export async function setServiceHidden(
  service: string,
  hidden: boolean,
): Promise<void> {
  if (!REGISTRY.has(service)) throw new Error(`unknown service "${service}"`);
  const existing = await db
    .select()
    .from(schema.serviceSettings)
    .where(eq(schema.serviceSettings.service, service))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(schema.serviceSettings).values({
      service,
      enabled: false,
      hidden,
      updatedAt: new Date(),
    });
  } else {
    await db
      .update(schema.serviceSettings)
      .set({ hidden, updatedAt: new Date() })
      .where(eq(schema.serviceSettings.service, service));
  }
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
        // Seed role-appropriate tool access now that the MCP is connected.
        if (typeof svc.roleDeniedGroups === "function") {
          await seedRoleToolAccessForUser(u.id);
        }
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
 * Seeds role-appropriate tool access for a user from every connected managed
 * service that declares a `roleDeniedGroups` policy. The denied groups' tool
 * ids become native `tools.deny` entries — so a restricted role never even sees
 * its denied tool groups, automatically, the moment they're connected/synced.
 *
 * Role is the source of truth for the role-policy services' tool space: on
 * each run we clear those services' existing deny entries and rewrite them
 * from the current role. Operator denies on OTHER services and the managed
 * cross-user globs are preserved (setAgentToolDeny owns the globs).
 *
 * Dynamic-imports tool-access to avoid a managed-mcp ⇄ tool-access import cycle.
 */
export async function seedRoleToolAccessForUser(
  userId: string,
): Promise<{ changed: boolean }> {
  const userRows = await db
    .select({ agentId: schema.users.agentId })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const agentId = userRows[0]?.agentId;
  if (!agentId) return { changed: false };

  const roleServices = listManagedMcpServices().filter(
    (s) => typeof s.roleDeniedGroups === "function" && (s.toolGroups?.length ?? 0) > 0,
  );
  if (roleServices.length === 0) return { changed: false };

  // Tool ids owned by any role-policy service (cleared each run), and the
  // fresh deny ids for this user's role on each connected such service.
  const ownedToolIds = new Set<string>();
  const roleDenyIds = new Set<string>();
  for (const svc of roleServices) {
    const serverName = managedMcpServerName(svc, agentId);
    const groups = svc.toolGroups ?? [];
    for (const g of groups)
      for (const t of g.tools) ownedToolIds.add(gatewayToolName(serverName, t));

    let connected = false;
    try {
      connected = (await svc.readStatus(userId)).connected === true;
    } catch {
      connected = false;
    }
    if (!connected) continue; // disconnected → just clear stale denies, add none

    let deniedGroups: string[] = [];
    try {
      deniedGroups = await svc.roleDeniedGroups!(userId);
    } catch (err) {
      console.error(`[managed-mcp] roleDeniedGroups(${svc.service}, ${userId}) failed:`, err);
      continue;
    }
    const denySet = new Set(deniedGroups);
    for (const g of groups)
      if (denySet.has(g.id))
        for (const t of g.tools) roleDenyIds.add(gatewayToolName(serverName, t));
  }

  const { readAgentToolAccess, setAgentToolDeny } = await import("./tool-access");
  const acc = await readAgentToolAccess(agentId);
  // Keep operator denies on non-role-policy tools; rewrite the role-policy
  // services' deny space from the role.
  const kept = acc.denied.filter((d) => !ownedToolIds.has(d));
  const next = Array.from(new Set([...kept, ...roleDenyIds]));
  return await setAgentToolDeny(agentId, next);
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
  // Seed role-appropriate tool access from every connected role-policy service
  // (e.g. a restricted role's denied tool groups are applied automatically).
  try {
    await seedRoleToolAccessForUser(userId);
  } catch (err) {
    console.error(`[managed-mcp] seedRoleToolAccessForUser(${userId}) failed:`, err);
  }
  return out;
}

/**
 * One-time repair for tenants provisioned before server names were capped at
 * the gateway's 30 characters. A longer name is exposed to every agent under
 * its truncated form (the deny globs never matched it), so each user who still
 * has one gets their managed MCPs re-registered under the short name. Costs a
 * single config read when there is nothing to repair. Returns the repaired
 * users' ids.
 */
export async function repairLegacyServerNames(): Promise<string[]> {
  // Per-user gateways were all created after the cap and hold one agent each;
  // there is nothing another agent could see.
  if (gatewayMode() === "per-user") return [];
  const { blob } = await readGatewayConfig();
  const users = await db.select().from(schema.users);
  const repaired: string[] = [];
  for (const u of users) {
    if (!u.agentId) continue;
    const stale = legacyManagedServerNames(blob, u.agentId);
    if (stale.length === 0) continue;
    console.warn(
      `[managed-mcp] ${u.email}: re-registering MCP server(s) with over-long names (${stale.join(", ")}) — other agents could see their tools`,
    );
    await syncAllManagedMcpsForUser(u.id);
    // The agent's AGENTS.md names its tools by server name; rewrite it too.
    // Dynamic import: sync-skills imports this module.
    const { syncSkillsForUser } = await import("./sync-skills");
    await syncSkillsForUser(u.id);
    repaired.push(u.id);
  }
  // A service that is no longer enabled/connected never re-registers, so its
  // legacy entry would survive the loop above. Drop whatever is left.
  const snapshot = await readGatewayConfig();
  let dropped = false;
  for (const u of users) {
    if (!u.agentId) continue;
    for (const name of legacyManagedServerNames(snapshot.blob, u.agentId)) {
      delete snapshot.blob.mcp!.servers![name];
      dropped = true;
    }
  }
  if (dropped) {
    applyManagedToolPolicies(snapshot.blob);
    await writeGatewayConfig(snapshot);
  }
  return repaired;
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
