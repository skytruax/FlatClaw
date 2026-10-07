import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { listGatewayHandles } from "@/lib/gateways/registry";
import { gatewayMode } from "@/lib/gateways/paths";
import { gatewayProcessStatus } from "@/lib/gateways/supervisor";
import { openclawVersionStatus } from "@/lib/openclaw/version-pin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Tiny health endpoint the page polls when a gateway is mid-startup.
 * Shared mode: `ok` once the one gateway answers `models.list`. Per-user
 * mode: `ok` once every user's gateway answers (a stopped gateway is listed
 * as not ok), with one row per gateway. Also reports which OpenClaw the
 * gateways run next to the version FlatClaw was verified against.
 * Admin-only — same trust boundary as the rest of /admin.
 */
export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const perUser = gatewayMode() === "per-user";
  let handles;
  try {
    handles = await listGatewayHandles();
  } catch (err) {
    return NextResponse.json({ ok: false, starting: false, error: err instanceof Error ? err.message : String(err) });
  }
  const gateways: Array<{ agentId: string | null; ok: boolean; state?: string; error?: string }> = [];
  let version: string | null = null;
  let starting = false;
  for (const h of handles) {
    const state = h.record ? gatewayProcessStatus(h.record.agentId).state : undefined;
    try {
      await h.client.call("models.list", {}, 4_000);
      version = version ?? h.client.getServerInfo()?.version ?? null;
      gateways.push({ agentId: h.agentId, ok: true, state });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNAVAILABLE|gateway startup|still starting|not ready/i.test(msg)) starting = true;
      gateways.push({ agentId: h.agentId, ok: false, state, error: msg });
    }
  }
  const ok = gateways.length > 0 && gateways.every((g) => g.ok);
  const failed = gateways.filter((g) => !g.ok);
  return NextResponse.json({
    ok,
    starting: !ok && starting,
    mode: perUser ? "per-user" : "shared",
    gateways,
    ...(ok ? {} : { error: failed.length ? failed.map((g) => `${g.agentId ?? "gateway"}: ${g.error}`).join("; ") : "no gateways yet" }),
    openclaw: openclawVersionStatus(version),
  });
}
