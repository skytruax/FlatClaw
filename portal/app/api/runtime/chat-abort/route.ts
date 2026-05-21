import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { getGatewayClient } from "@/lib/openclaw/adapter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    targetUserId?: string;
    runId?: string;
  };

  const targetUserId =
    session.user.role === "admin" && body.targetUserId
      ? body.targetUserId
      : session.user.id;

  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, targetUserId))
    .limit(1);
  if (rows.length === 0 || !rows[0].agentId)
    return NextResponse.json({ error: "no agent" }, { status: 404 });

  const sessionKey = `agent:${rows[0].agentId}:main`;
  try {
    const client = getGatewayClient();
    const params: Record<string, unknown> = { sessionKey };
    if (body.runId) params.runId = body.runId;
    const result = await client.call("chat.abort", params);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
