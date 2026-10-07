/**
 * Which gateway serves which agent.
 *
 * In shared mode every agent is on the one gateway the adapter has always
 * connected to. In per-user mode each agent has a row in `agent_gateways`
 * (its state directory, port, Unix account and sealed token), and this module
 * hands out one connected client per agent. Code that knows its agent calls
 * `gatewayClientFor(agentId)`; code that must touch every gateway (the
 * tenant baseline, the skill allowlist, inference settings) iterates
 * `listGatewayHandles()`. `getGatewayClient()` from the adapter remains the
 * shared gateway only.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { decrypt, encrypt, type SealedSecret } from "@/lib/crypto/aes-gcm";
import { OpenClawClient, getGatewayClient } from "@/lib/openclaw/adapter";
import { gatewayMode } from "./paths";

export interface GatewayRecord {
  agentId: string;
  userId: string;
  stateDir: string;
  port: number;
  uid: number | null;
  gid: number | null;
  unixUser: string | null;
  token: string;
}

const tokenAad = (agentId: string) => `agent-gateway:${agentId}`;

export function gatewayUrlFor(record: Pick<GatewayRecord, "port">): string {
  return `ws://127.0.0.1:${record.port}`;
}

function toRecord(row: typeof schema.agentGateways.$inferSelect): GatewayRecord {
  return {
    agentId: row.agentId,
    userId: row.userId,
    stateDir: row.stateDir,
    port: row.port,
    uid: row.uid ?? null,
    gid: row.gid ?? null,
    unixUser: row.unixUser ?? null,
    token: decrypt(JSON.parse(row.tokenSealed) as SealedSecret, tokenAad(row.agentId)),
  };
}

export async function gatewayRecord(agentId: string): Promise<GatewayRecord | null> {
  const rows = await db.select().from(schema.agentGateways).where(eq(schema.agentGateways.agentId, agentId)).limit(1);
  return rows.length ? toRecord(rows[0]) : null;
}

export async function gatewayRecordForUser(userId: string): Promise<GatewayRecord | null> {
  const rows = await db.select().from(schema.agentGateways).where(eq(schema.agentGateways.userId, userId)).limit(1);
  return rows.length ? toRecord(rows[0]) : null;
}

export async function listGatewayRecords(): Promise<GatewayRecord[]> {
  const rows = await db.select().from(schema.agentGateways);
  return rows.map(toRecord);
}

/**
 * The gateway an agent id lives on: its own record, or, for a service
 * sub-agent (`<agent>-<service>`, see service-subagents.ts), its owner's.
 */
export async function resolveGatewayRecord(agentId: string): Promise<GatewayRecord | null> {
  const own = await gatewayRecord(agentId);
  if (own) return own;
  let best: GatewayRecord | null = null;
  for (const record of await listGatewayRecords()) {
    if (agentId.startsWith(`${record.agentId}-`) && (!best || record.agentId.length > best.agentId.length)) best = record;
  }
  return best;
}

export async function saveGatewayRecord(record: GatewayRecord): Promise<void> {
  const tokenSealed = JSON.stringify(encrypt(record.token, tokenAad(record.agentId)));
  await db
    .insert(schema.agentGateways)
    .values({
      agentId: record.agentId,
      userId: record.userId,
      stateDir: record.stateDir,
      port: record.port,
      uid: record.uid,
      gid: record.gid,
      unixUser: record.unixUser,
      tokenSealed,
    })
    .onConflictDoUpdate({
      target: schema.agentGateways.agentId,
      set: { stateDir: record.stateDir, port: record.port, uid: record.uid, gid: record.gid, unixUser: record.unixUser, tokenSealed, updatedAt: new Date() },
    });
}

export async function deleteGatewayRecord(agentId: string): Promise<void> {
  await db.delete(schema.agentGateways).where(eq(schema.agentGateways.agentId, agentId));
  forgetGatewayClient(agentId);
}

// One client per agent, kept across Next.js hot reloads like the adapter's singleton.
const CLIENTS_KEY = Symbol.for("flatclaw.gateway.clients");
type ClientSlot = { [CLIENTS_KEY]?: Map<string, OpenClawClient> };
function clients(): Map<string, OpenClawClient> {
  const slot = globalThis as unknown as ClientSlot;
  if (!slot[CLIENTS_KEY]) slot[CLIENTS_KEY] = new Map();
  return slot[CLIENTS_KEY]!;
}

export function clientForRecord(record: GatewayRecord): OpenClawClient {
  const cached = clients().get(record.agentId);
  if (cached) return cached;
  const client = new OpenClawClient(gatewayUrlFor(record), record.token);
  clients().set(record.agentId, client);
  return client;
}

/** The connected client for an agent's gateway (the shared gateway in shared mode). */
export async function gatewayClientFor(agentId: string): Promise<OpenClawClient> {
  if (gatewayMode() === "shared") return getGatewayClient();
  const record = await resolveGatewayRecord(agentId);
  if (!record) throw new Error(`no gateway is provisioned for agent ${agentId}`);
  return clientForRecord(record);
}

/** Session keys are `agent:<agentId>:<rest>`; the gateway that owns the agent owns the session. */
export async function gatewayClientForSessionKey(sessionKey: string): Promise<OpenClawClient> {
  if (gatewayMode() === "shared") return getGatewayClient();
  const m = /^agent:([^:]+):/.exec(sessionKey);
  if (!m) throw new Error(`session key ${JSON.stringify(sessionKey)} names no agent`);
  return gatewayClientFor(m[1]);
}

/**
 * The gateway to answer a user's own requests: their agent's gateway, or, for
 * an admin without an agent, any gateway (an admin's questions about models
 * are the same on every gateway).
 */
export async function gatewayClientForUser(userId: string, isAdmin: boolean): Promise<OpenClawClient> {
  if (gatewayMode() === "shared") return getGatewayClient();
  const own = await gatewayRecordForUser(userId);
  if (own) return clientForRecord(own);
  if (isAdmin) {
    const [first] = await listGatewayRecords();
    if (first) return clientForRecord(first);
    throw new Error("no gateway exists yet; add a user first");
  }
  throw new Error("this user has no gateway");
}

/** Drop (and close) an agent's cached client, e.g. after its gateway was stopped or re-created. */
export function forgetGatewayClient(agentId: string): void {
  const client = clients().get(agentId);
  if (client) {
    client.close();
    clients().delete(agentId);
  }
}

export interface GatewayHandle {
  /** Null for the shared gateway. */
  agentId: string | null;
  record: GatewayRecord | null;
  client: OpenClawClient;
}

/** Every gateway this portal administers: one handle in shared mode, one per user otherwise. */
export async function listGatewayHandles(): Promise<GatewayHandle[]> {
  if (gatewayMode() === "shared") return [{ agentId: null, record: null, client: getGatewayClient() }];
  return (await listGatewayRecords()).map((record) => ({ agentId: record.agentId, record, client: clientForRecord(record) }));
}
