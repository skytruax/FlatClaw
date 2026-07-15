import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
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
    sessionKey?: string;
    message?: string;
    idempotencyKey?: string;
    /** Per-turn thinking-level override. openclaw prepends `/think <level>` to the message. */
    thinking?: string;
    /**
     * Dropped/pasted files & images, passed straight to openclaw's `chat.send`
     * (inlines small images for vision models, offloads large/other files to disk).
     * Each: { type:"image"|"file", mimeType, fileName, content:<base64-no-prefix> }.
     */
    attachments?: Array<{
      type?: string;
      mimeType?: string;
      fileName?: string;
      content?: string;
    }>;
  };

  // Whitelist of valid thinking levels (openclaw's set). Anything else is
  // dropped so the turn falls back to agents.defaults.thinkingDefault.
  const THINKING_LEVELS = new Set([
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "adaptive",
    "max",
  ]);
  const thinking =
    typeof body.thinking === "string" && THINKING_LEVELS.has(body.thinking)
      ? body.thinking
      : undefined;

  const targetUserId =
    session.user.role === "admin" && body.targetUserId
      ? body.targetUserId
      : session.user.id;

  const targetRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, targetUserId))
    .limit(1);
  if (targetRows.length === 0)
    return NextResponse.json({ error: "no such user" }, { status: 404 });
  const target = targetRows[0];
  if (!target.agentId)
    return NextResponse.json(
      { error: "user is not provisioned as an agent" },
      { status: 400 },
    );

  const sessionKey = body.sessionKey ?? `agent:${target.agentId}:main`;
  const message = String(body.message ?? "").trim();
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (!message && attachments.length === 0)
    return NextResponse.json({ error: "empty message" }, { status: 400 });

  try {
    const client = getGatewayClient();
    const result = await client.call("chat.send", {
      sessionKey,
      message,
      idempotencyKey: body.idempotencyKey ?? randomUUID(),
      ...(thinking ? { thinking } : {}),
      ...(attachments.length ? { attachments } : {}),
    });
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
