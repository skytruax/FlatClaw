/**
 * Which gateway events the portal relays to a browser.
 *
 * The portal holds ONE gateway connection, as an operator, and that
 * connection receives every agent's events plus gateway-wide ones that belong
 * to no session at all (approval requests carrying command text, device
 * pairing, presence, scheduler activity). A browser must only ever receive the
 * events of the agent it is looking at, so the relay is an allowlist on both
 * axes: a known event name AND a session key under that agent. Everything else
 * is dropped — an event with no session key included, because there is nothing
 * to tie it to a viewer.
 *
 * `scripts/gateway-contract-probe.ts` checks against a live gateway that the
 * events carrying conversation content still name their session
 * (`events.session-scoped`). `sessions.changed` also arrives as a bare
 * gateway-wide notice (`{reason: "runner-availability"}` and the like); those
 * are dropped here, and the chat page does not need them.
 */
export const RELAYED_GATEWAY_EVENTS = [
  "chat", //             assistant text (state = delta | final | aborted | error)
  "agent", //            agent run / tool stream
  "session.tool", //     per-session tool lifecycle (start / result)
  "session.message", //  a finalized transcript message
  "sessions.changed", // session metadata (compaction, label, message count)
] as const;

const RELAYED = new Set<string>(RELAYED_GATEWAY_EVENTS);

/** The session an event belongs to, or null when it names none. */
export function eventSessionKey(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const key = (payload as { sessionKey?: unknown }).sessionKey;
  return typeof key === "string" && key.length > 0 ? key : null;
}

/** True when `sessionKey` is one of `agentId`'s sessions (sub-agent sessions included). */
export function sessionBelongsToAgent(sessionKey: string, agentId: string): boolean {
  return agentId.length > 0 && sessionKey.startsWith(`agent:${agentId}:`);
}

/** True when a gateway event may be sent to a browser viewing `agentId`. */
export function isRelayedToAgent(
  eventName: string,
  payload: unknown,
  agentId: string,
): boolean {
  if (!RELAYED.has(eventName)) return false;
  const key = eventSessionKey(payload);
  return key !== null && sessionBelongsToAgent(key, agentId);
}
