import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { listWorkspaceFiles, workspaceExists } from "@/lib/workspace/fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const targetUserId =
    session.user.role === "admin" && url.searchParams.get("userId")
      ? url.searchParams.get("userId")!
      : session.user.id;
  const path = url.searchParams.get("path") ?? "";

  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, targetUserId))
    .limit(1);
  if (rows.length === 0 || !rows[0].agentId)
    return NextResponse.json({ error: "no agent" }, { status: 404 });

  const agentId = rows[0].agentId;
  if (!workspaceExists(agentId))
    return NextResponse.json({ entries: [], missing: true });

  try {
    const entries = await listWorkspaceFiles(agentId, path);
    return NextResponse.json({ entries });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
