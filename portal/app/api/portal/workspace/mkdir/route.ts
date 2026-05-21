import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function workspaceRoot(agentId: string) {
  return resolve(homedir(), ".openclaw", `workspace-${agentId}`);
}

function safeJoin(root: string, relPath: string): string | null {
  if (!relPath || relPath === "/" || relPath === ".") return null;
  const cleaned = relPath.replace(/^\/+/, "");
  if (cleaned.split(/[\\/]+/).some((seg) => seg === "..")) return null;
  const abs = resolve(root, cleaned);
  if (!abs.startsWith(root + sep) && abs !== root) return null;
  return abs;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    userId?: string;
    path?: string;
  };
  const targetUserId =
    session.user.role === "admin" && body.userId ? body.userId : session.user.id;
  const path = String(body.path ?? "").trim();
  if (!path)
    return NextResponse.json({ error: "path required" }, { status: 400 });

  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, targetUserId))
    .limit(1);
  if (rows.length === 0 || !rows[0].agentId)
    return NextResponse.json({ error: "no agent" }, { status: 404 });

  const root = workspaceRoot(rows[0].agentId);
  const abs = safeJoin(root, path);
  if (!abs)
    return NextResponse.json({ error: "invalid path" }, { status: 400 });

  await mkdir(abs, { recursive: true });
  return NextResponse.json({ ok: true });
}
