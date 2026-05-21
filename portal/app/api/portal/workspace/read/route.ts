import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { readWorkspaceFile } from "@/lib/workspace/fs";

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
  const path = url.searchParams.get("path");
  if (!path)
    return NextResponse.json({ error: "path required" }, { status: 400 });

  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, targetUserId))
    .limit(1);
  if (rows.length === 0 || !rows[0].agentId)
    return NextResponse.json({ error: "no agent" }, { status: 404 });

  try {
    const result = await readWorkspaceFile(rows[0].agentId, path);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
