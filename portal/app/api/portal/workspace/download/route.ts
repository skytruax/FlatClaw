import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve, sep } from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function workspaceRoot(agentId: string) {
  return resolve(homedir(), ".openclaw", `workspace-${agentId}`);
}

function safeJoin(root: string, relPath: string): string | null {
  if (!relPath) return null;
  const cleaned = relPath.replace(/^\/+/, "");
  if (cleaned.split(/[\\/]+/).some((seg) => seg === "..")) return null;
  const abs = resolve(root, cleaned);
  if (!abs.startsWith(root + sep) && abs !== root) return null;
  return abs;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return new Response("unauthorized", { status: 401 });

  const url = new URL(req.url);
  const targetUserId =
    session.user.role === "admin" && url.searchParams.get("userId")
      ? url.searchParams.get("userId")!
      : session.user.id;
  const path = url.searchParams.get("path");
  if (!path) return new Response("path required", { status: 400 });

  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, targetUserId))
    .limit(1);
  if (rows.length === 0 || !rows[0].agentId)
    return new Response("no agent", { status: 404 });

  const root = workspaceRoot(rows[0].agentId);
  const abs = safeJoin(root, path);
  if (!abs) return new Response("invalid path", { status: 400 });

  try {
    const s = await stat(abs);
    if (!s.isFile()) return new Response("not a file", { status: 400 });
    const buf = await readFile(abs);
    const name = basename(abs);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
        "Content-Length": String(s.size),
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
