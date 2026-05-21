import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import "@/lib/openclaw/services"; // ensure managed-MCP registry is populated
import { readAgentToolAccess, setAgentToolDeny } from "@/lib/openclaw/tool-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Per-user tool access. Reads/writes the user's agent
 * `agents.list[<agentId>].tools.deny` (OpenClaw's native tool policy) — the
 * admin toggles built-in tool groups + specific MCP tools off, the gateway
 * filters them from the agent's roster. No custom policy layer.
 *
 *   GET /api/portal/users/<userId>/tool-access
 *       → { ok, agentId, exists, denied, builtinGroups, mcpServers }
 *   PUT body: { denied: string[] }  → { ok, changed, denied }
 *
 * Admin-only.
 */

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { error: "unauthorized" as const, status: 401 };
  if (session.user.role !== "admin")
    return { error: "admin only" as const, status: 403 };
  return { actorId: session.user.id };
}

async function resolveAgentId(userId: string) {
  const rows = await db
    .select({ agentId: schema.users.agentId })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (rows.length === 0) return { error: "unknown user", status: 404 as const };
  if (!rows[0].agentId)
    return { error: "user has no agent yet — create/sync the agent first", status: 409 as const };
  return { agentId: rows[0].agentId };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const guard = await requireAdmin();
  if ("error" in guard)
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { userId } = await params;
  const r = await resolveAgentId(userId);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

  const access = await readAgentToolAccess(r.agentId);
  return NextResponse.json({ ok: true, ...access });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const guard = await requireAdmin();
  if ("error" in guard)
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { userId } = await params;
  const r = await resolveAgentId(userId);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

  const body = (await req.json().catch(() => null)) as { denied?: unknown } | null;
  if (!body || !Array.isArray(body.denied))
    return NextResponse.json({ error: "body must include denied: string[]" }, { status: 400 });
  const denied = body.denied.filter((d): d is string => typeof d === "string");

  const { changed } = await setAgentToolDeny(r.agentId, denied);
  const access = await readAgentToolAccess(r.agentId);
  return NextResponse.json({ ok: true, changed, denied: access.denied });
}
