import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { getGatewayClient } from "@/lib/openclaw/adapter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-sent events stream of gateway events filtered to the acting user's
 * agent. Admin can override the filter via ?agent=<agentId>.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return new Response("unauthorized", { status: 401 });

  const url = new URL(req.url);
  const agentOverride = url.searchParams.get("agent");
  const wantAgentId = await (async () => {
    if (session.user.role === "admin" && agentOverride) return agentOverride;
    const me = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, session.user.id))
      .limit(1);
    return me[0]?.agentId ?? null;
  })();
  if (!wantAgentId)
    return new Response("user has no agent", { status: 400 });

  const sessionKeyPrefix = `agent:${wantAgentId}:`;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // controller may be closed if client disconnected
        }
      };

      send("ready", { agentId: wantAgentId });

      const client = getGatewayClient();
      const unsubscribe = client.on((eventName, payload) => {
        // Debug: log every gateway event so we can see what we're getting.
        console.log(
          `[stream] event=${eventName} sessionKey=${(payload as { sessionKey?: string } | null)?.sessionKey ?? "<none>"}`,
        );
        // Forward EVERYTHING for now; client decides what to render.
        // Per-agent scoping can be re-added once we confirm payload shapes.
        const sk = (payload as { sessionKey?: string } | null)?.sessionKey;
        if (sk && !sk.startsWith(sessionKeyPrefix)) return;
        send(eventName, payload);
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25000);

      const onAbort = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener("abort", onAbort);
      // Ensure client is connected so we receive events
      client.connect().catch((err) => {
        send("runtime.error", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
