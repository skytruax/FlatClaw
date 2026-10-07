import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import type { OpenClawClient } from "@/lib/openclaw/adapter";
import { gatewayClientFor } from "@/lib/gateways/registry";
import { isRelayedToAgent } from "@/lib/openclaw/stream-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-sent events stream of gateway events for the acting user's agent.
 * Admin can pick another agent via ?agent=<agentId>.
 *
 * The gateway connection behind this is shared by every viewer and carries
 * every agent's events, so only the events in RELAYED_GATEWAY_EVENTS are
 * forwarded, and only when they belong to one of this agent's sessions
 * (lib/openclaw/stream-events.ts).
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

  // This agent's gateway (the shared one in shared mode). In per-user mode the
  // connection behind it carries only this user's events.
  let client: OpenClawClient;
  try {
    client = await gatewayClientFor(wantAgentId);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 503 });
  }

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

      const unsubscribe = client.on((eventName, payload) => {
        if (!isRelayedToAgent(eventName, payload, wantAgentId)) return;
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
