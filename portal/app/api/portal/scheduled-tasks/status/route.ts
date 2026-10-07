/**
 * Cron subsystem health — `cron.status {}`. Admin-only; surfaced in the
 * tenant-wide scheduler view as a read-only status pane.
 *
 *   GET /api/portal/scheduled-tasks/status  → { status }
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { listGatewayHandles } from "@/lib/gateways/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "admin")
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    // One gateway in shared mode; one per user otherwise (all reported).
    const gateways = await Promise.all(
      (await listGatewayHandles()).map(async (h) => ({ agentId: h.agentId, status: await h.client.call("cron.status", {}) })),
    );
    return NextResponse.json({ status: gateways[0]?.status ?? null, gateways });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
