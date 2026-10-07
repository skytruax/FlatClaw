/**
 * Which chat messages the gateway may treat as slash commands.
 *
 * OpenClaw lets the owner of a gateway run it from chat: `/restart`,
 * `/update`, `/model <id> -g` (the default model for everyone), `/exec`,
 * `/openclaw` and some fifty more. It decides who the owner is by the scopes
 * of the connection a message arrives on — and every portal user's message
 * arrives on the portal's one connection, which is an operator with admin
 * scope. Left alone, every user of a tenant is its owner.
 *
 * So the portal sends user text with `suppressCommandInterpretation: true`:
 * the gateway then delivers it to the agent as plain text, slashes and all.
 * The exception is the short list below, each of which only touches the
 * sender's own session. A command is only let through as the entire message —
 * `/status` yes, `/status /model x -g` no — because OpenClaw also applies
 * directives that ride along inside a longer message.
 *
 * (`commands.restart` and the other command gates are switched off as well, in
 * tenant-baseline.ts. Those are config keys; `/model -g` and `/openclaw` have
 * none, which is why the filtering has to happen here.)
 */
export const ALLOWED_CHAT_COMMANDS = ["new", "reset", "stop", "compact", "status"] as const;

const ALLOWED = new Set<string>(ALLOWED_CHAT_COMMANDS);

/** True when `message` is exactly one allowed slash command and nothing else. */
export function isAllowedChatCommand(message: string): boolean {
  const match = /^\/([a-z_]+)$/i.exec(message.trim());
  return match !== null && ALLOWED.has(match[1].toLowerCase());
}
