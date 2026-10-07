import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { gatewayClientForSessionKey } from "@/lib/gateways/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Compaction surface — compact a session on demand. The gateway is the source
 * of truth; this route is a thin proxy.
 *
 *   POST  /api/portal/sessions/<sessionKey>/compaction
 *     body: { action: "compact", maxLines?: number }
 *       // tail-trim to maxLines if given, else a full (model-written) compaction
 *
 * Checkpoints are gone: openclaw 2026.9.6 retired `sessions.compaction.list`,
 * `.restore` and `.branch` ("Retire compaction checkpoint controls while
 * preserving history"), so there is no longer a list to show or a state to
 * roll back to.
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

interface CompactionAction {
  action?: "compact";
  maxLines?: number;
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
  if (body.action !== "compact") {
    return NextResponse.json(
      { error: 'action must be "compact"' },
      { status: 400 },
    );
  }

  const compactParams: Record<string, unknown> = { key: decoded };
  if (typeof body.maxLines === "number" && body.maxLines > 0) {
    compactParams.maxLines = Math.floor(body.maxLines);
  }
  // Full compaction can take ~30-60s on a long session — generous timeout.
  const result = await (await gatewayClientForSessionKey(decoded)).call(
    "sessions.compact",
    compactParams,
    120_000,
  );
  return NextResponse.json({ ok: true, ...((result as object) ?? {}) });
}
