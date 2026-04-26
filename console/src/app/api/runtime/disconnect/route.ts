import { NextResponse } from "next/server";

import { deriveRuntimeFreshness } from "@/lib/controlplane/degraded-read";
import { peekControlPlaneRuntime } from "@/lib/controlplane/runtime";
import { applyStudioSettingsPatch } from "@/lib/studio/settings-store";

export const runtime = "nodejs";

export async function POST() {
  try {
    applyStudioSettingsPatch({ gatewayAutoStart: false });
    const controlPlane = peekControlPlaneRuntime();
    if (!controlPlane) {
      const summary = {
        status: "stopped" as const,
        reason: null,
        asOf: null,
        outboxHead: 0,
      };
      return NextResponse.json({
        enabled: true,
        summary,
        freshness: deriveRuntimeFreshness(summary, null),
      });
    }

    await controlPlane.disconnect();
    const summary = controlPlane.snapshot();
    return NextResponse.json({
      enabled: true,
      summary,
      freshness: deriveRuntimeFreshness(summary, null),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to disconnect Studio runtime.";
    return NextResponse.json({ enabled: true, error: message }, { status: 500 });
  }
}
