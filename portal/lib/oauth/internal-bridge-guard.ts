import { NextResponse } from "next/server";
import {
  resolveCapabilityToken,
  type CapabilityScope,
} from "./capability-tokens";

/**
 * Shared guard for `/api/internal/<service>-token` routes.
 *
 * Every per-service bridge endpoint applies the same three checks before
 * decoding the vault row:
 *
 *   1. Source IP must be loopback (the MCP runs on the same host).
 *   2. `Authorization: Bearer <capability_token>` must be present.
 *   3. The token must resolve to (userId, scope=<expected scope>) and not be
 *      revoked.
 *
 * Usage:
 *
 *   const guard = await runInternalBridgeGuard(req, "cpanel.token");
 *   if (guard instanceof NextResponse) return guard;  // 401/403/etc
 *   const { userId } = guard;
 *
 * Returning the guard's `NextResponse` directly keeps each route's body
 * to "decode my vault row, return it" — no auth boilerplate.
 */
export async function runInternalBridgeGuard(
  req: Request,
  expectedScope: CapabilityScope,
): Promise<{ userId: string; scope: CapabilityScope } | NextResponse> {
  const xff = req.headers.get("x-forwarded-for");
  const remote =
    (xff?.split(",")[0]?.trim() ?? "") ||
    (req.headers.get("x-real-ip") ?? "") ||
    "";
  const isLoopback =
    remote === "" ||
    remote === "127.0.0.1" ||
    remote === "::1" ||
    remote === "::ffff:127.0.0.1";
  if (!isLoopback)
    return NextResponse.json({ error: "loopback only" }, { status: 403 });

  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)/i.exec(auth);
  if (!m) return NextResponse.json({ error: "missing bearer" }, { status: 401 });
  const token = m[1];

  const cap = await resolveCapabilityToken(token);
  if (!cap || cap.scope !== expectedScope)
    return NextResponse.json({ error: "invalid capability" }, { status: 401 });

  return { userId: cap.userId, scope: cap.scope as CapabilityScope };
}
