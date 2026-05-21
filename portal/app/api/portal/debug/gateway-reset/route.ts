import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { resetGatewayClient } from "@/lib/openclaw/adapter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Force a fresh WebSocket to the openclaw gateway. Use when the singleton
 * gets stuck on a dead connection (e.g. after the gateway is restarted out
 * from under us). Admin-only.
 */
export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  resetGatewayClient();
  return NextResponse.json({ ok: true });
}
