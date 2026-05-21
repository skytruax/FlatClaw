import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getGatewayClient } from "@/lib/openclaw/adapter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Tiny health endpoint the page polls when the gateway is mid-startup.
 * Returns { ok: true } once `models.list` succeeds again so the client can
 * stop polling and refresh the page. Admin-only — same trust boundary as
 * the rest of /admin.
 */
export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const client = getGatewayClient();
    await client.call("models.list", {}, 4_000);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const starting = /UNAVAILABLE|gateway startup|still starting|not ready/i.test(msg);
    return NextResponse.json({ ok: false, starting, error: msg });
  }
}
