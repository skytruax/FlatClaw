/**
 * Files the portal writes into a user's workspace must end up owned by the
 * user's gateway account, or the agent (running as that account) could read
 * but never change or remove them. No-op in shared mode and whenever the
 * gateway has no account of its own.
 */
import { chownSync, lstatSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { gatewayMode } from "./paths";
import { resolveGatewayRecord } from "./registry";

export function chownTree(path: string, uid: number, gid: number): void {
  chownSync(path, uid, gid);
  if (lstatSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) chownTree(join(path, entry), uid, gid);
  }
}

/** Give `absPath` (and, with `recursive`, everything under it) to the agent's gateway account. */
export async function adoptIntoWorkspace(agentId: string, absPath: string, opts: { recursive?: boolean } = {}): Promise<void> {
  if (gatewayMode() !== "per-user") return;
  const record = await resolveGatewayRecord(agentId);
  if (!record || record.uid === null || record.gid === null) return;
  if (opts.recursive) chownTree(absPath, record.uid, record.gid);
  else chownSync(absPath, record.uid, record.gid);
}

/** After `mkdir -p` below a workspace: adopt every directory between `root` and `abs`. */
export async function adoptCreatedPath(agentId: string, root: string, abs: string): Promise<void> {
  if (gatewayMode() !== "per-user") return;
  const rel = relative(root, abs);
  if (!rel || rel.startsWith("..")) return;
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    await adoptIntoWorkspace(agentId, current);
  }
}
