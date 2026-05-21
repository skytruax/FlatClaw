import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { getGatewayClient } from "@/lib/openclaw/adapter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

/**
 * Rename a session. The new title gets written to both:
 *   - the gateway via `sessions.patch({ key, label })` (so it survives a
 *     portal DB wipe and is visible to the openclaw control UI)
 *   - the portal's sessions_meta cache (so the sidebar list stays fast and
 *     can show the new title even before the gateway broadcast catches up)
 */
export async function PATCH(
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

  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title)
    return NextResponse.json({ error: "title is required" }, { status: 400 });

  try {
    const client = getGatewayClient();
    await client.call("sessions.patch", { key: decoded, label: title });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  // Upsert sessions_meta. There's no UNIQUE on (userId, openclawSessionKey),
  // so we update if exists, else insert.
  const existing = await db
    .select()
    .from(schema.sessionsMeta)
    .where(
      and(
        eq(schema.sessionsMeta.userId, session.user.id),
        eq(schema.sessionsMeta.openclawSessionKey, decoded),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(schema.sessionsMeta)
      .set({ title })
      .where(eq(schema.sessionsMeta.id, existing[0].id));
  } else {
    await db.insert(schema.sessionsMeta).values({
      id: randomUUID(),
      userId: session.user.id,
      openclawSessionKey: decoded,
      title,
    });
  }

  return NextResponse.json({ ok: true, title });
}

/**
 * Delete a session. The gateway rejects deleting an agent's `:main` session
 * (it's the catch-all thread that has to exist), so the UI hides the
 * delete button on `:main` rows. We surface the gateway's error verbatim
 * for any other rejection.
 */
export async function DELETE(
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

  try {
    const client = getGatewayClient();
    await client.call("sessions.delete", { key: decoded });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  // Drop the cache row too so the sidebar list reconciles cleanly.
  await db
    .delete(schema.sessionsMeta)
    .where(eq(schema.sessionsMeta.openclawSessionKey, decoded));

  return NextResponse.json({ ok: true });
}
