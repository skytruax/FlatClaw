/**
 * Executor for approved Jira actions.
 *
 * The Jira MCP never executes an approval-gated tool: it captures the exact
 * mutating REST call (method + url + json, no credentials) and returns it as
 * a PENDING_HUMAN_APPROVAL envelope. On human approval the queue calls this
 * with the composed request and the requesting agent (derived from the
 * session that composed it, not from the envelope), and we replay the call
 * with that user's own vault credentials.
 *
 * Guards: only the requesting user's credentials are ever used, the target
 * URL must be on that user's own Jira workspace, and only mutating methods
 * are executable — a poisoned transcript can neither pick another user nor
 * point this executor at a foreign host.
 */

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { readJiraCredential } from "@/lib/credentials/jira";

interface ComposedRest {
  tool?: string;
  method?: string;
  url?: string;
  json?: unknown;
}

const EXECUTABLE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function executeJiraApproval(input: {
  kind: string;
  composedRequest: unknown;
  requestedByAgentId?: string;
}): Promise<{ summary: string } | null> {
  const composed = (input.composedRequest ?? {}) as ComposedRest;
  if (!input.requestedByAgentId) {
    throw new Error("jira approval: missing requesting agent");
  }
  if (!composed.url || !composed.method) {
    throw new Error("jira approval: composed request is missing method/url");
  }
  const method = String(composed.method).toUpperCase();
  if (!EXECUTABLE_METHODS.has(method)) {
    throw new Error(`jira approval: method ${method} is not executable`);
  }

  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.agentId, input.requestedByAgentId))
    .limit(1);
  const userId = rows[0]?.id;
  if (!userId) {
    throw new Error(`jira approval: no user for agent ${input.requestedByAgentId}`);
  }
  const creds = await readJiraCredential(userId);
  if (!creds) throw new Error("jira approval: user has no Jira credentials");

  const target = new URL(composed.url);
  const workspace = new URL(creds.workspaceUrl);
  if (target.origin !== workspace.origin) {
    throw new Error(
      `jira approval: composed URL ${target.origin} is not the user's workspace ${workspace.origin}`,
    );
  }

  const basic = Buffer.from(`${creds.email}:${creds.apiToken}`, "utf8").toString("base64");
  const res = await fetch(target.toString(), {
    method,
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
      ...(composed.json !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: composed.json !== undefined ? JSON.stringify(composed.json) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `jira approval: ${method} ${target.pathname} → ${res.status} ${text.slice(0, 200)}`,
    );
  }
  return {
    summary: `${composed.tool ?? input.kind}: ${method} ${target.pathname} → ${res.status}`,
  };
}
