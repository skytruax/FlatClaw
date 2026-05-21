import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { getGatewayClient } from "@/lib/openclaw/adapter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Per-session token-usage + context-weight snapshot.
 *
 *   GET /api/portal/sessions/<key>/usage
 *     →  {
 *          totalTokens:           number | null,   // cumulative I/O tokens (0 on free providers)
 *          contextTokens:         number | null,   // model's per-session ctx cap
 *          systemPromptChars:     number | null,   // openclaw's measured prompt size
 *          toolSchemaChars:       number | null,   // sum of tool-schema chars
 *          estimatedPromptTokens: number | null,   // (system + tools) chars / 4
 *          messageCount:          number | null,   // total messages in transcript
 *          checkpointCount:       number | null,   // compaction checkpoints
 *        }
 *
 * The portal's chat header uses this to populate the live token meter:
 *   - totalTokens > 0 → show that (real cumulative usage from cost tracker)
 *   - else show estimatedPromptTokens (deterministic char-based estimate
 *     of what's actively in context — system + tools + workspace files,
 *     refreshed by openclaw on every run)
 */

interface ContextWeight {
  systemPrompt?: { chars?: number };
  tools?: { schemaChars?: number };
  injectedWorkspaceFiles?: Array<{ injectedChars?: number; missing?: boolean }>;
}

interface SessionUsageEntry {
  key?: string;
  contextTokens?: number;
  contextWeight?: ContextWeight;
  usage?: {
    totalTokens?: number;
    input?: number;
    output?: number;
    messageCounts?: { total?: number };
    dailyMessageCounts?: Array<{ total?: number }>;
  };
  compactionCheckpointCount?: number;
}

interface UsageResult {
  sessions?: SessionUsageEntry[];
}

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
  const result = (await client.call("sessions.usage", {
    key: decoded,
    includeContextWeight: true,
  })) as UsageResult;
  const entry = result.sessions?.[0];

  // sessions.usage doesn't include contextTokens — pull from sessions.describe
  // (or fall back to agents.defaults.contextTokens). Without this the meter
  // denominator is null and renders as "—".
  let contextTokens: number | null = null;
  if (typeof entry?.contextTokens === "number") {
    contextTokens = entry.contextTokens;
  } else {
    try {
      const desc = (await client.call("sessions.describe", { key: decoded })) as {
        session?: { contextTokens?: number; agentId?: string } | null;
      };
      const sess = desc.session;
      if (sess && typeof sess.contextTokens === "number") {
        contextTokens = sess.contextTokens;
      } else {
        const cfgResult = (await client.call("config.get", {})) as {
          blob?: {
            agents?: {
              defaults?: { contextTokens?: number };
              list?: Array<{ id?: string; contextTokens?: number }>;
            };
          };
        };
        const blob = cfgResult.blob ?? {};
        const perAgent = sess?.agentId
          ? blob.agents?.list?.find((a) => a.id === sess.agentId)?.contextTokens
          : undefined;
        contextTokens =
          perAgent ?? blob.agents?.defaults?.contextTokens ?? null;
      }
    } catch {
      /* best-effort fallback */
    }
  }

  // Fetch checkpoint count separately — sessions.usage doesn't include it.
  let checkpointCount = 0;
  try {
    const cp = (await client.call("sessions.compaction.list", {
      key: decoded,
    })) as { checkpoints?: unknown[] };
    checkpointCount = cp.checkpoints?.length ?? 0;
  } catch {
    /* best-effort */
  }

  if (!entry) {
    return NextResponse.json({
      totalTokens: null,
      contextTokens, // already resolved via sessions.describe / config.get fallback
      systemPromptChars: null,
      toolSchemaChars: null,
      estimatedPromptTokens: null,
      messageCount: null,
      checkpointCount,
    });
  }

  const cw = entry.contextWeight ?? {};
  const systemChars = cw.systemPrompt?.chars ?? null;
  const toolChars = cw.tools?.schemaChars ?? null;
  // Workspace file injections (AGENTS/SOUL/TOOLS/etc.) DO count toward the
  // active prompt — sum their injected chars.
  const wsChars = (cw.injectedWorkspaceFiles ?? []).reduce(
    (acc, f) => acc + (!f.missing ? f.injectedChars ?? 0 : 0),
    0,
  );
  const totalChars =
    (systemChars ?? 0) + (toolChars ?? 0) + wsChars;
  // openclaw's own heuristic uses chars/4. (See pi-embedded-runner/
  // tool-result-truncation.ts:220.)
  const estimatedPromptTokens = totalChars > 0 ? Math.ceil(totalChars / 4) : null;
  const totalTokens = entry.usage?.totalTokens ?? 0;

  return NextResponse.json({
    totalTokens: totalTokens > 0 ? totalTokens : null,
    contextTokens,
    systemPromptChars: systemChars,
    toolSchemaChars: toolChars,
    workspaceFileChars: wsChars > 0 ? wsChars : null,
    estimatedPromptTokens,
    messageCount: entry.usage?.dailyMessageCounts?.reduce(
      (acc, d) => acc + (d.total ?? 0),
      0,
    ) ?? null,
    checkpointCount,
  });
}
