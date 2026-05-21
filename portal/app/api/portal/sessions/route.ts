import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { getGatewayClient } from "@/lib/openclaw/adapter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface GatewaySession {
  sessionKey?: string;
  key?: string;
  sessionId?: string;
  title?: string;
  derivedTitle?: string;
  displayName?: string;
  label?: string;
  agentId?: string;
  // Gateway uses `updatedAt` (not `lastMessageAtMs`) for the most-recent
  // activity timestamp on a session row.
  updatedAt?: number;
  startedAt?: number;
  // `includeLastMessage: true` makes the gateway populate `lastMessagePreview`
  // (a plain string of the first ~chars of the most recent message).
  lastMessagePreview?: string;
  // `totalTokensFresh` is a boolean flag the gateway already sets on every
  // session row. The actual numeric `totalTokens` lives behind
  // `sessions.usage`, not `sessions.list` — see route below.
  totalTokensFresh?: boolean;
  contextTokens?: number;
  hasActiveRun?: boolean;
  status?: string;
}

interface GatewaySessionsListResult {
  sessions?: GatewaySession[];
}

interface PortalSession {
  sessionKey: string;
  title: string | null;
  /** First few words from the most recent message — for sidebar previews. */
  description: string | null;
  isMain: boolean;
  lastMessageAt: number | null;
  messageCount: number;
  totalTokens: number | null;
  totalTokensFresh: boolean;
  contextTokens: number | null;
  compactionCheckpointCount: number;
  latestCompactionAt: number | null;
  latestCompactionReason: string | null;
}

/**
 * Pull a short description preview from the gateway's `lastMessagePreview`
 * field (populated when sessions.list is called with `includeLastMessage:
 * true`). Strips heartbeat envelopes, markdown, whitespace; caps at 120
 * chars. Returns null when nothing meaningful exists.
 */
function buildDescription(s: GatewaySession): string | null {
  const raw = s.lastMessagePreview;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const cleaned = raw
    // strip heartbeat envelope: "[Wed 2026-05-06 14:57 EDT] ..."
    .replace(/^\[[A-Z][a-z]{2}\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+\w+\]\s*/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > 120 ? cleaned.slice(0, 117).trimEnd() + "…" : cleaned;
}

/**
 * Light cleanup of openclaw's title strings — only strips the heartbeat
 * bracket envelope (`[Wed 2026-05-06 14:57 EDT] …`) which is added by the
 * chat-channel layer and not part of the meaningful title. Everything else
 * (auto-derived UUID-stamps, raw labels, dates) is rendered verbatim so
 * the portal sidebar matches openclaw's own session list.
 */
function cleanTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let t = raw.trim();
  // Strip leading `[…]` envelope (timestamp prefix from the heartbeat tick).
  t = t.replace(/^\s*\[[^\]]*\]\s*/, "");
  t = t.trim();
  return t || null;
}

/** Determines which agent the caller is allowed to query. */
async function resolveAgentId(
  userId: string,
  isAdmin: boolean,
  override: string | null,
): Promise<string | null> {
  if (isAdmin && override) return override;
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return rows[0]?.agentId ?? null;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const overrideAgent = url.searchParams.get("agent");
  const agentId = await resolveAgentId(
    session.user.id,
    session.user.role === "admin",
    overrideAgent,
  );
  if (!agentId)
    return NextResponse.json(
      { error: "no agent for this user" },
      { status: 400 },
    );

  // Pull live session list from the gateway (source of truth) and the portal's
  // sessions_meta cache (for fast titles + last-viewed). Gateway list wins on
  // "this session exists", DB wins on operator-edited titles.
  let gatewaySessions: GatewaySession[] = [];
  // Fallback context window: even on a fresh pre-first-turn session the
  // gateway has no totalTokens yet, but we want the meter to show "— / 32 k"
  // not "— / —". Pull the agent's contextTokens from agents.defaults via
  // config.get; per-agent overrides win if set. Cached for one request.
  let defaultContextTokens: number | null = null;
  try {
    const client = getGatewayClient();
    // includeDerivedTitles asks the gateway to fall back to the first user
    // message (truncated) when the session has no explicit label/displayName
    // — gives us "Drafts about Q3 customer feedback" instead of a UUID
    // without us having to run any LLM ourselves.
    const r = (await client.call("sessions.list", {
      agentId,
      includeDerivedTitles: true,
      includeLastMessage: true,
    })) as GatewaySessionsListResult;
    gatewaySessions = r.sessions ?? [];
    const cfgResult = (await client.call("config.get", {})) as {
      blob?: {
        agents?: {
          defaults?: { contextTokens?: number };
          list?: Array<{ id?: string; contextTokens?: number }>;
        };
      };
    };
    const blob = cfgResult.blob ?? {};
    const perAgent = blob.agents?.list?.find((a) => a.id === agentId)?.contextTokens;
    defaultContextTokens =
      perAgent ?? blob.agents?.defaults?.contextTokens ?? null;
  } catch (err) {
    console.warn("[sessions.list] gateway call failed:", err);
  }

  // Gateway IS the source of truth. Previous version merged a portal-side
  // sessions_meta cache for "operator-renamed titles" — but the rename
  // PATCH already writes through to the gateway via `sessions.patch`, so
  // the cache was redundant AND caused dupes when the cache held a stale
  // row under a slightly different key format than what the gateway
  // returned. No cache, no merge, no dedup ambiguity.
  const mainKey = `agent:${agentId}:main`;
  const result: PortalSession[] = [];
  const seen = new Set<string>();
  for (const s of gatewaySessions) {
    const key = s.sessionKey ?? s.key;
    if (!key) continue;
    if (seen.has(key)) continue; // gateway shouldn't dupe, but be defensive
    // Hide openclaw control-UI sessions (port 18789's dashboard surface).
    // Those use `agent:<id>:dashboard:<uuid>` keys; portal-created
    // sessions are `agent:<id>:<uuid>` (or `:main`). Mixing both made
    // the sidebar look like everything was duplicated.
    if (key.startsWith(`agent:${agentId}:dashboard:`)) continue;
    seen.add(key);
    // Title precedence: explicit label/displayName (operator-set via
    // sessions.patch) wins over the auto-derived fallback, then over the
    // raw title field.
    const gatewayTitle = cleanTitle(
      s.label ?? s.displayName ?? s.title ?? s.derivedTitle ?? null,
    );
    result.push({
      sessionKey: key,
      title: gatewayTitle,
      description: buildDescription(s),
      isMain: key === mainKey,
      lastMessageAt: s.updatedAt ?? s.startedAt ?? null,
      messageCount: 0, // not surfaced in sessions.list shape; usage call has it if needed
      // sessions.list doesn't include totalTokens — that's behind sessions.usage.
      // Per-session usage is fetched on demand by the chat panel; the list
      // route just surfaces the static contextTokens denominator.
      totalTokens: null,
      totalTokensFresh: !!s.totalTokensFresh,
      contextTokens:
        typeof s.contextTokens === "number"
          ? s.contextTokens
          : defaultContextTokens,
      compactionCheckpointCount: 0,
      latestCompactionAt: null,
      latestCompactionReason: null,
    });
  }
  // Always surface the agent's main session even if the gateway doesn't
  // know it yet (fresh agent with no chat history).
  if (!seen.has(mainKey)) {
    result.push({
      sessionKey: mainKey,
      title: "Main",
      description: null,
      isMain: true,
      lastMessageAt: null,
      messageCount: 0,
      totalTokens: null,
      totalTokensFresh: false,
      contextTokens: defaultContextTokens,
      compactionCheckpointCount: 0,
      latestCompactionAt: null,
      latestCompactionReason: null,
    });
  }
  // Sort by last-message recency only — no special pinning. Sessions with
  // no activity (fresh "Main" on a brand-new agent) sort last.
  result.sort(
    (a, b) =>
      (b.lastMessageAt ?? -Infinity) - (a.lastMessageAt ?? -Infinity),
  );

  return NextResponse.json({ agentId, sessions: result });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    agentId?: string;
    title?: string;
  };
  const overrideAgent =
    session.user.role === "admin" && body.agentId ? body.agentId : null;
  const agentId = await resolveAgentId(
    session.user.id,
    session.user.role === "admin",
    overrideAgent,
  );
  if (!agentId)
    return NextResponse.json(
      { error: "no agent for this user" },
      { status: 400 },
    );

  try {
    const client = getGatewayClient();
    const r = (await client.call("sessions.create", {
      agentId,
      ...(body.title && { title: body.title }),
    })) as { sessionKey?: string; sessionId?: string };
    const sessionKey =
      r.sessionKey ??
      (r.sessionId ? `agent:${agentId}:${r.sessionId}` : null);
    if (!sessionKey) {
      return NextResponse.json(
        { error: "gateway returned no sessionKey" },
        { status: 502 },
      );
    }
    await db.insert(schema.sessionsMeta).values({
      id: randomUUID(),
      userId: session.user.id,
      openclawSessionKey: sessionKey,
      title: body.title ?? null,
    });
    return NextResponse.json({ sessionKey, title: body.title ?? null });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
