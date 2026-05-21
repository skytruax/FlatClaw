import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join, dirname, sep } from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILE_BYTES = 500 * 1024 * 1024;

function workspaceRoot(agentId: string) {
  return resolve(homedir(), ".openclaw", `workspace-${agentId}`);
}

function safeJoin(root: string, relPath: string): string | null {
  if (!relPath) return root;
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

  const url = new URL(req.url);
  const targetUserId =
    session.user.role === "admin" && url.searchParams.get("userId")
      ? url.searchParams.get("userId")!
      : session.user.id;

  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, targetUserId))
    .limit(1);
  if (rows.length === 0 || !rows[0].agentId)
    return NextResponse.json({ error: "no agent" }, { status: 404 });

  const root = workspaceRoot(rows[0].agentId);
  const form = await req.formData();
  const dir = String(form.get("path") ?? "").trim();
  const targetDir = safeJoin(root, dir);
  if (!targetDir)
    return NextResponse.json({ error: "invalid path" }, { status: 400 });

  await mkdir(targetDir, { recursive: true });
  const saved: string[] = [];

  for (const value of form.getAll("file")) {
    if (!(value instanceof File)) continue;
    if (value.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `${value.name} exceeds 500 MB` },
        { status: 413 },
      );
    }
    const safe = value.name.replace(/[\/\\]/g, "_");
    const dest = join(targetDir, safe);
    if (!dest.startsWith(root))
      return NextResponse.json({ error: "invalid name" }, { status: 400 });
    await mkdir(dirname(dest), { recursive: true });
    const buf = Buffer.from(await value.arrayBuffer());
    await writeFile(dest, buf);
    saved.push(safe);
  }

  return NextResponse.json({ ok: true, saved });
}
