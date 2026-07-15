/**
 * Executor for approved Google actions.
 *
 * The Google MCP never executes an approval-gated tool (gmail_send,
 * drive_delete, …): it captures the exact mutating REST call (method + url +
 * json, no credentials) and returns it as a PENDING_HUMAN_APPROVAL envelope.
 * On human approval the queue calls this with the composed request and the
 * requesting agent (derived from the session that composed it), and we replay
 * the call with a fresh access token for that user.
 *
 * Guards: only the requesting user's token is ever used, the target host must
 * be a googleapis.com API host, and only mutating methods are executable.
 */

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getValidServiceAccessToken } from "@/lib/credentials/oauth-token-bridge";

interface ComposedRest {
  tool?: string;
  method?: string;
  url?: string;
  json?: unknown;
}

const EXECUTABLE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isGoogleApiHost(hostname: string): boolean {
  return hostname === "googleapis.com" || hostname.endsWith(".googleapis.com");
}

export async function executeGoogleApproval(input: {
  kind: string;
  composedRequest: unknown;
  requestedByAgentId?: string;
}): Promise<{ summary: string } | null> {
  const composed = (input.composedRequest ?? {}) as ComposedRest;
  if (!input.requestedByAgentId) {
    throw new Error("google approval: missing requesting agent");
  }
  if (!composed.url || !composed.method) {
    throw new Error("google approval: composed request is missing method/url");
  }
  const method = String(composed.method).toUpperCase();
  if (!EXECUTABLE_METHODS.has(method)) {
    throw new Error(`google approval: method ${method} is not executable`);
  }

  const target = new URL(composed.url);
  if (target.protocol !== "https:" || !isGoogleApiHost(target.hostname)) {
    throw new Error(`google approval: ${target.host} is not a Google API host`);
  }

  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.agentId, input.requestedByAgentId))
    .limit(1);
  const userId = rows[0]?.id;
  if (!userId) {
    throw new Error(`google approval: no user for agent ${input.requestedByAgentId}`);
  }
  const { accessToken } = await getValidServiceAccessToken(userId, "google");

  const res = await fetch(target.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(composed.json !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: composed.json !== undefined ? JSON.stringify(composed.json) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `google approval: ${method} ${target.pathname} → ${res.status} ${text.slice(0, 200)}`,
    );
  }
  return {
    summary: `${composed.tool ?? input.kind}: ${method} ${target.pathname} → ${res.status}`,
  };
}
