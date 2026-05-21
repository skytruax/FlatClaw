import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getGatewayClient } from "@/lib/openclaw/adapter";
import { transcriptToBubbles } from "@/lib/openclaw/transcript";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ChatHistoryResult {
  sessionKey?: string;
  sessionId?: string;
  messages?: unknown[];
}

/**
 * Returns the session's full transcript, transformed into the chat panel's
 * bubble shape so it renders identically to live-streamed conversations
 * (tool calls, results, reasoning, all included).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionKey: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { sessionKey } = await params;
  const decoded = decodeURIComponent(sessionKey);

  // Authz: a non-admin can only read sessions belonging to their own agent.
  if (session.user.role !== "admin") {
    const me = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, session.user.id))
      .limit(1);
    const agentId = me[0]?.agentId;
    if (!agentId || !decoded.startsWith(`agent:${agentId}:`)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  try {
    const client = getGatewayClient();
    const r = (await client.call("chat.history", {
      sessionKey: decoded,
    })) as ChatHistoryResult;
    const messages = Array.isArray(r.messages) ? r.messages : [];
    const bubbles = transcriptToBubbles(messages as never[]);
    return NextResponse.json({
      sessionKey: r.sessionKey ?? decoded,
      sessionId: r.sessionId,
      bubbles,
      messageCount: messages.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
