import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { deleteWorkspacePath } from "@/lib/workspace/fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Delete a file or directory in the agent's workspace.
 *
 *   POST /api/portal/workspace/delete
 *     body: { path: string, recursive?: boolean, userId?: string (admin only) }
 *     → { ok, kind, bytes, path }
 *
 * - `path` is workspace-relative; absolute paths and `..` escapes are rejected
 *   by `deleteWorkspacePath`.
 * - `recursive: true` is required to delete a non-empty directory.
 * - The workspace root and managed agent files (AGENTS.md, SOUL.md, etc.) are
 *   refused unconditionally.
 * - Audit-logged on every successful delete.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    userId?: string;
    path?: string;
    recursive?: boolean;
  };
  const targetUserId =
    session.user.role === "admin" && body.userId ? body.userId : session.user.id;
  const path = String(body.path ?? "").trim();
  if (!path) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, targetUserId))
    .limit(1);
  if (rows.length === 0 || !rows[0].agentId) {
    return NextResponse.json({ error: "no agent" }, { status: 404 });
  }

  try {
    const result = await deleteWorkspacePath(rows[0].agentId, path, {
      recursive: !!body.recursive,
    });
    await db.insert(schema.auditLog).values({
      id: randomUUID(),
      actorUserId: session.user.id,
      action: `workspace.delete.${result.kind}`,
      targetUserId,
      metadata: {
        path: result.path,
        bytes: result.bytes,
        recursive: !!body.recursive,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
