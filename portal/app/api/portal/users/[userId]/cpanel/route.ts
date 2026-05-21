import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  setCpanelCredential,
  readCpanelStatus,
  deleteCpanelCredential,
} from "@/lib/credentials/cpanel";
import {
  provisionCpanelMcpForUser,
  deprovisionCpanelMcpForUser,
} from "@/lib/openclaw/cpanel-mcp";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireActor(userId: string, allowSelf: boolean) {
  const session = await auth();
  if (!session?.user) return { error: "unauthorized" as const, status: 401 };
  if (session.user.role !== "admin" && (!allowSelf || session.user.id !== userId)) {
    return { error: "forbidden" as const, status: 403 };
  }
  return { actorId: session.user.id, role: session.user.role };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const guard = await requireActor(userId, true);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const status = await readCpanelStatus(userId);
  return NextResponse.json({ ok: true, ...status });
}

interface PostBody {
  username?: string;
  apiToken?: string;
  serverUrl?: string;
  verifySsl?: boolean;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  // Only admins can mint creds for other users; users can self-update.
  const guard = await requireActor(userId, true);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const username = (body.username ?? "").trim();
  const apiToken = (body.apiToken ?? "").trim();
  const serverUrl = (body.serverUrl ?? "").trim();
  if (!username || !apiToken || !serverUrl) {
    return NextResponse.json(
      { error: "username, apiToken, and serverUrl are required" },
      { status: 400 },
    );
  }

  await setCpanelCredential(userId, {
    username,
    apiToken,
    serverUrl,
    verifySsl: body.verifySsl !== false,
  });

  // Mint cap token + register the per-user MCP server. Best-effort: if the
  // gateway is unreachable, the vault row is still saved and the next
  // provision attempt (or admin click) will pick it up.
  let provisioned: { serverName: string } | null = null;
  try {
    const r = await provisionCpanelMcpForUser(userId);
    if (r) provisioned = { serverName: r.serverName };
  } catch (err) {
    console.warn(
      "[cpanel] provision failed (creds saved, MCP not registered):",
      err,
    );
  }

  // Audit: who set creds for whom.
  await db.insert(schema.auditLog).values({
    id: randomUUID(),
    actorUserId: guard.actorId,
    action: "cpanel.credentials.set",
    targetUserId: userId,
    metadata: { serverUrl, username, provisioned: !!provisioned },
  });

  return NextResponse.json({ ok: true, provisioned });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const guard = await requireActor(userId, true);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // Tear down the gateway-side wiring first; if that fails, the vault row
  // still has to go (caller asked to disconnect).
  try {
    await deprovisionCpanelMcpForUser(userId);
  } catch (err) {
    console.warn("[cpanel] deprovision failed (continuing to vault delete):", err);
  }
  await deleteCpanelCredential(userId);

  await db.insert(schema.auditLog).values({
    id: randomUUID(),
    actorUserId: guard.actorId,
    action: "cpanel.credentials.delete",
    targetUserId: userId,
    metadata: null,
  });

  return NextResponse.json({ ok: true });
}
