import { NextResponse } from "next/server";

import { ensureDomainIntentRuntime, parseIntentBody } from "@/lib/controlplane/intent-route";
import { ControlPlaneGatewayError } from "@/lib/controlplane/openclaw-adapter";
import { slugifyAgentName } from "@/lib/gateway/agentConfig";

export const runtime = "nodejs";

type GatewayConfigSnapshot = {
  path?: string | null;
};

const dirnameLike = (value: string): string => {
  const lastSlash = value.lastIndexOf("/");
  const lastBackslash = value.lastIndexOf("\\");
  const index = Math.max(lastSlash, lastBackslash);
  if (index < 0) return "";
  return value.slice(0, index);
};

const joinPathLike = (dir: string, leaf: string): string => {
  const sep = dir.includes("\\") ? "\\" : "/";
  const trimmedDir = dir.endsWith("/") || dir.endsWith("\\") ? dir.slice(0, -1) : dir;
  return `${trimmedDir}${sep}${leaf}`;
};

export async function POST(request: Request) {
  const bodyOrError = await parseIntentBody(request);
  if (bodyOrError instanceof Response) {
    return bodyOrError as NextResponse;
  }

  const name = typeof bodyOrError.name === "string" ? bodyOrError.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }

  const runtimeOrError = await ensureDomainIntentRuntime();
  if (runtimeOrError instanceof Response) {
    return runtimeOrError as NextResponse;
  }

  try {
    const snapshot = await runtimeOrError.callGateway<GatewayConfigSnapshot>("config.get", {});
    const configPath = typeof snapshot.path === "string" ? snapshot.path.trim() : "";
    if (!configPath) {
      throw new Error(
        'Gateway did not return a config path; cannot compute a default workspace for "agents.create".'
      );
    }
    const stateDir = dirnameLike(configPath);
    if (!stateDir) {
      throw new Error(
        `Gateway config path "${configPath}" is missing a directory; cannot compute workspace.`
      );
    }
    const workspace = joinPathLike(stateDir, `workspace-${slugifyAgentName(name)}`);
    const payload = await runtimeOrError.callGateway("agents.create", {
      name,
      workspace,
    });
    return NextResponse.json({ ok: true, payload });
  } catch (err) {
    if (err instanceof ControlPlaneGatewayError) {
      if (err.code.trim().toUpperCase() === "GATEWAY_UNAVAILABLE") {
        return NextResponse.json(
          { error: err.message, code: "GATEWAY_UNAVAILABLE", reason: "gateway_unavailable" },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: err.message, code: err.code, details: err.details },
        { status: 400 }
      );
    }
    const message = err instanceof Error ? err.message : "intent_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
