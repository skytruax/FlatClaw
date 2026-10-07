/**
 * Where things live, in both gateway modes.
 *
 * FlatClaw runs OpenClaw in one of two ways:
 *
 *   shared    one gateway for every user (the arrangement until 2026-10),
 *             state under ~/.openclaw, workspaces at ~/.openclaw/workspace-<agent>
 *   per-user  one gateway per portal user, each with its own state directory,
 *             port, token and (when the portal runs as root) its own Unix user,
 *             under <portal data dir>/gateways/<agent id>/
 *
 * `FLATCLAW_GATEWAY_MODE` selects the mode; shared is the default until a
 * deployment has been migrated (scripts/migrate-to-per-user-gateways.ts).
 * Everything that needs a path or a port goes through here, so no other file
 * has to know which mode it is in.
 */
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type GatewayMode = "shared" | "per-user";

export function gatewayMode(): GatewayMode {
  return process.env.FLATCLAW_GATEWAY_MODE === "per-user" ? "per-user" : "shared";
}

/** Agent ids come from slugifyAgentId; anything else must never become a path. */
export function assertAgentId(agentId: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(agentId)) {
    throw new Error(`invalid agent id ${JSON.stringify(agentId)}`);
  }
  return agentId;
}

/** The portal's own data directory (the SQLite database, the device identity, the gateways). */
export function portalDataDir(): string {
  return dirname(process.env.PORTAL_DB_PATH ?? join(homedir(), ".openclaw-portal", "portal.db"));
}

/** Root of the per-user gateway state directories. */
export function gatewaysRoot(): string {
  return process.env.FLATCLAW_GATEWAYS_DIR ?? join(portalDataDir(), "gateways");
}

/** A user's gateway state directory (per-user mode). */
export function gatewayStateDir(agentId: string): string {
  return join(gatewaysRoot(), assertAgentId(agentId));
}

/** The shared gateway's state directory (shared mode, and the source of a migration). */
export function sharedStateDir(): string {
  if (process.env.PORTAL_OPENCLAW_STATE_DIR) return process.env.PORTAL_OPENCLAW_STATE_DIR;
  if (process.env.PORTAL_OPENCLAW_CONFIG) return dirname(process.env.PORTAL_OPENCLAW_CONFIG);
  return join(homedir(), ".openclaw");
}

/** The gateway config file an agent's gateway reads. */
export function gatewayConfigPathFor(agentId: string): string {
  return gatewayMode() === "per-user"
    ? join(gatewayStateDir(agentId), "openclaw.json")
    : (process.env.PORTAL_OPENCLAW_CONFIG ?? join(sharedStateDir(), "openclaw.json"));
}

/** An agent's workspace directory, as the gateway and the portal both see it. */
export function workspacePathFor(agentId: string, gatewayAgentId: string = agentId): string {
  assertAgentId(agentId);
  return gatewayMode() === "per-user"
    ? join(gatewayStateDir(gatewayAgentId), `workspace-${agentId}`)
    : join(sharedStateDir(), `workspace-${agentId}`);
}

/** First port handed to a per-user gateway; the next user gets the next free one. */
export function gatewayPortBase(): number {
  const n = Number(process.env.FLATCLAW_GATEWAY_PORT_BASE ?? 18800);
  return Number.isInteger(n) && n > 1024 && n < 65000 ? n : 18800;
}

/** Smallest port at or above the base that no gateway holds yet. */
export function allocateGatewayPort(portsInUse: Iterable<number>): number {
  const used = new Set(portsInUse);
  for (let port = gatewayPortBase(); port < 65535; port++) {
    if (!used.has(port)) return port;
  }
  throw new Error("no free gateway port");
}

/**
 * The Unix account a user's gateway runs as. Linux caps names at 32
 * characters; agent ids can be that long themselves, so the name keeps the
 * start of the id and a short hash of the whole.
 */
export function gatewayUnixUserName(agentId: string, hash8: string): string {
  assertAgentId(agentId);
  const head = agentId.replace(/[^a-z0-9-]/g, "").slice(0, 20).replace(/-+$/, "");
  return `fcg-${head}-${hash8.slice(0, 6)}`;
}
