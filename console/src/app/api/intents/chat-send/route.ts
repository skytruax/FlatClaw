import { NextResponse } from "next/server";

import { executeGatewayIntent, parseIntentBody } from "@/lib/controlplane/intent-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const bodyOrError = await parseIntentBody(request);
  if (bodyOrError instanceof Response) {
    return bodyOrError as NextResponse;
  }

  const sessionKey = typeof bodyOrError.sessionKey === "string" ? bodyOrError.sessionKey.trim() : "";
  const message = typeof bodyOrError.message === "string" ? bodyOrError.message : "";
  const idempotencyKey =
    typeof bodyOrError.idempotencyKey === "string" ? bodyOrError.idempotencyKey.trim() : "";
  const deliver = Boolean(bodyOrError.deliver);

  if (!sessionKey || !message.trim() || !idempotencyKey) {
    return NextResponse.json(
      { error: "sessionKey, message, and idempotencyKey are required." },
      { status: 400 }
    );
  }

  return await executeGatewayIntent("chat.send", {
    sessionKey,
    message,
    idempotencyKey,
    deliver,
  });
}
