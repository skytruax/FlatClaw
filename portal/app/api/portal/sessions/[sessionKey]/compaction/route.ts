import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { getGatewayClient } from "@/lib/openclaw/adapter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Compaction surface — list/compact/restore/branch a session's compaction
 * history. The gateway is the source of truth; this route is a thin proxy.
 *
 *   GET   /api/portal/sessions/<sessionKey>/compaction
 *     → { checkpoints: SessionCompactionCheckpoint[] }
 *
 *   POST  /api/portal/sessions/<sessionKey>/compaction
 *     body: one of
 *       { action: "compact",  maxLines?: number }   // tail-trim if maxLines, else full Pi compaction
 *       { action: "restore",  checkpointId: string } // roll back to pre-compaction state
 *       { action: "branch",   checkpointId: string } // fork a new session at the checkpoint
 *
 * Auth: admin can act on any session; other users only on their own agent's.
 */

async function authorizeSession(
  user: { id: string; role?: string },
  decoded: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (user.role === "admin") return { ok: true };
  const me = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);
  const agentId = me[0]?.agentId;
  if (!agentId || !decoded.startsWith(`agent:${agentId}:`)) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionKey: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { sessionKey } = await params;
  const decoded = decodeURIComponent(sessionKey);
  const ok = await authorizeSession(session.user, decoded);
  if (!ok.ok)
    return NextResponse.json({ error: ok.error }, { status: ok.status });

  const client = getGatewayClient();
  const result = (await client.call("sessions.compaction.list", {
    key: decoded,
  })) as { checkpoints?: unknown[] };
  return NextResponse.json({ checkpoints: result.checkpoints ?? [] });
}

interface CompactionAction {
  action?: "compact" | "restore" | "branch";
  maxLines?: number;
  checkpointId?: string;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionKey: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { sessionKey } = await params;
  const decoded = decodeURIComponent(sessionKey);
  const ok = await authorizeSession(session.user, decoded);
  if (!ok.ok)
    return NextResponse.json({ error: ok.error }, { status: ok.status });

  const body = (await req.json().catch(() => ({}))) as CompactionAction;
  const action = body.action;
  const client = getGatewayClient();

  if (action === "compact") {
    const params: Record<string, unknown> = { key: decoded };
    if (typeof body.maxLines === "number" && body.maxLines > 0) {
      params.maxLines = Math.floor(body.maxLines);
    }
    // Full compaction can take ~30-60s on a long session — generous timeout.
    const result = await client.call("sessions.compact", params, 120_000);
    return NextResponse.json({ ok: true, ...((result as object) ?? {}) });
  }
  if (action === "restore") {
    if (!body.checkpointId)
      return NextResponse.json(
        { error: "checkpointId required" },
        { status: 400 },
      );
    const result = await client.call("sessions.compaction.restore", {
      key: decoded,
      checkpointId: body.checkpointId,
    });
    return NextResponse.json({ ok: true, ...((result as object) ?? {}) });
  }
  if (action === "branch") {
    if (!body.checkpointId)
      return NextResponse.json(
        { error: "checkpointId required" },
        { status: 400 },
      );
    const result = await client.call("sessions.compaction.branch", {
      key: decoded,
      checkpointId: body.checkpointId,
    });
    return NextResponse.json({ ok: true, ...((result as object) ?? {}) });
  }

  return NextResponse.json(
    { error: "action must be one of: compact, restore, branch" },
    { status: 400 },
  );
}
