import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { listGatewayHandles } from "@/lib/gateways/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // The roster names every user's agent on the tenant.
  if (session.user.role !== "admin")
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    const handles = await listGatewayHandles();
    if (handles.length === 1 && handles[0].agentId === null) {
      const result = await handles[0].client.call("agents.list", {});
      return NextResponse.json({ ok: true, result });
    }
    // Per-user mode: each gateway lists its own agent; the admin sees them all.
    const agents: unknown[] = [];
    for (const h of handles) {
      const r = (await h.client.call("agents.list", {})) as { agents?: Array<Record<string, unknown>> };
      for (const a of r.agents ?? []) agents.push({ ...a, gateway: h.agentId });
    }
    return NextResponse.json({ ok: true, result: { agents, gateways: handles.length } });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
