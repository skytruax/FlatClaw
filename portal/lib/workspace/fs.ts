import { readdir, stat, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join, relative, sep } from "node:path";

export interface FileEntry {
  name: string;
  path: string; // relative to workspace root, forward-slash
  kind: "file" | "directory";
  size: number;
  lastModified: string;
}

const HIDDEN_PREFIX = ".";
const SKIP_NAMES = new Set([
  "node_modules",
  ".git",
  ".DS_Store",
  ".openclaw", // workspace-state dir maintained by openclaw
  // Agent system files seeded by openclaw / portal at provisioning time.
  // These are managed by the gateway/portal and shouldn't be edited by users
  // through the file explorer.
  "AGENTS.md",
  "BOOTSTRAP.md",
  "HEARTBEAT.md",
  "IDENTITY.md",
  "SOUL.md",
  "TOOLS.md",
  "USER.md",
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function workspaceRoot(agentId: string): string {
  return resolve(homedir(), ".openclaw", `workspace-${agentId}`);
}

/**
 * Resolves a relative path inside the user's workspace and guards against
 * symlink/.. escapes. Returns the absolute path or null if invalid.
 */
function safeResolve(agentId: string, relPath: string | undefined | null): string | null {
  const root = workspaceRoot(agentId);
  if (!relPath || relPath === "" || relPath === "/" || relPath === ".") return root;
  // normalize: strip leading slashes, reject ../
  const cleaned = relPath.replace(/^\/+/, "");
  if (cleaned.split(/[\\/]+/).some((seg) => seg === "..")) return null;
  const abs = resolve(root, cleaned);
  if (!abs.startsWith(root + sep) && abs !== root) return null;
  return abs;
}

export async function listWorkspaceFiles(
  agentId: string,
  relPath = "",
): Promise<FileEntry[]> {
  const abs = safeResolve(agentId, relPath);
  if (!abs) throw new Error("invalid path");
  if (!existsSync(abs)) return [];

  const root = workspaceRoot(agentId);
  const dirents = await readdir(abs, { withFileTypes: true });
  const entries: FileEntry[] = [];
  for (const d of dirents) {
    if (SKIP_NAMES.has(d.name)) continue;
    if (d.name.startsWith(HIDDEN_PREFIX) && d.name !== ".gitignore") continue;
    const p = join(abs, d.name);
    let stats;
    try {
      stats = await stat(p);
    } catch {
      continue;
    }
    entries.push({
      name: d.name,
      path: relative(root, p).split(sep).join("/"),
      kind: d.isDirectory() ? "directory" : "file",
      size: d.isDirectory() ? 0 : stats.size,
      lastModified: stats.mtime.toISOString(),
    });
  }
  // dirs first, then files, alpha within each
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function readWorkspaceFile(
  agentId: string,
  relPath: string,
): Promise<{ content: string; truncated: boolean; size: number }> {
  const abs = safeResolve(agentId, relPath);
  if (!abs) throw new Error("invalid path");
  const stats = await stat(abs);
  if (!stats.isFile()) throw new Error("not a file");
  if (stats.size > MAX_FILE_BYTES) {
    const buf = await readFile(abs, { encoding: "utf8" });
    return {
      content: buf.slice(0, MAX_FILE_BYTES),
      truncated: true,
      size: stats.size,
    };
  }
  const content = await readFile(abs, "utf8");
  return { content, truncated: false, size: stats.size };
}

export function workspaceExists(agentId: string): boolean {
  return existsSync(workspaceRoot(agentId));
}

/**
 * Delete a file or directory inside the workspace. Refuses to delete:
 *   - the workspace root itself (empty/"/" relPath)
 *   - any path resolving outside the workspace (symlink/.. escape)
 *   - any of the agent system files in SKIP_NAMES (AGENTS.md, SOUL.md, etc.)
 *
 * Directories are removed recursively when `recursive: true`. Without
 * that flag, non-empty directories error and the caller has to confirm.
 */
export async function deleteWorkspacePath(
  agentId: string,
  relPath: string,
  options: { recursive?: boolean } = {},
): Promise<{ kind: "file" | "directory"; bytes: number; path: string }> {
  const abs = safeResolve(agentId, relPath);
  if (!abs) throw new Error("invalid path");
  const root = workspaceRoot(agentId);
  if (abs === root) {
    throw new Error("cannot delete the workspace root itself");
  }
  // Block deletion of agent system files (AGENTS.md, SOUL.md, etc.) at any depth.
  const segments = relative(root, abs).split(sep);
  for (const seg of segments) {
    if (SKIP_NAMES.has(seg)) {
      throw new Error(
        `${seg} is a managed agent file and cannot be deleted through the workspace UI`,
      );
    }
  }
  if (!existsSync(abs)) {
    throw new Error("not found");
  }
  const stats = await stat(abs);
  const kind = stats.isDirectory() ? "directory" : "file";
  if (kind === "directory" && !options.recursive) {
    const entries = await readdir(abs);
    if (entries.length > 0) {
      throw new Error(
        `directory not empty (${entries.length} entries) — pass recursive: true to delete its contents`,
      );
    }
  }
  await rm(abs, { recursive: !!options.recursive, force: false });
  return {
    kind,
    bytes: kind === "file" ? stats.size : 0,
    path: relative(root, abs).split(sep).join("/"),
  };
}
