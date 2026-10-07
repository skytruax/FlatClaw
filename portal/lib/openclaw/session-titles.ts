/**
 * Session titles written by the model.
 *
 * The sidebar used to show the session UUID (or the first message) until a
 * person renamed the session. Now, after the 1st, 2nd, 4th, 8th… turn of a
 * non-main session, the portal waits for the agent's reply, asks the tenant's
 * own inference endpoint for a 3–6 word title over the recent transcript, and
 * writes it through `sessions.patch({ key, label })` — the same path the
 * rename button uses, so it survives restarts and shows up on the next
 * sidebar poll. Nothing leaves the tenant: it is the same private model.
 *
 * Fire-and-forget from the chat-send route; failures are logged, never
 * surfaced to the chat.
 */

import { gatewayClientFor } from "@/lib/gateways/registry";
import { readInferenceSettings } from "@/lib/settings/inference";
import { transcriptToBubbles } from "@/lib/openclaw/transcript";

/** Turn numbers (per session, per portal process) that trigger a retitle. */
const RETITLE_ON_TURNS = new Set([1, 2, 4, 8, 16, 32]);
const RETITLE_EVERY_AFTER = 16;
const REPLY_WAIT_MS = 6 * 60_000;
const POLL_MS = 4_000;
const MAX_TITLE_CHARS = 60;

const turnCounts = new Map<string, number>();
const inflight = new Set<string>();

export function scheduleSessionTitle(agentId: string, sessionKey: string): void {
  if (sessionKey.endsWith(":main")) return; // "Main" is an anchor, not a topic
  const n = (turnCounts.get(sessionKey) ?? 0) + 1;
  turnCounts.set(sessionKey, n);
  if (!RETITLE_ON_TURNS.has(n) && n % RETITLE_EVERY_AFTER !== 0) return;
  if (inflight.has(sessionKey)) return;
  inflight.add(sessionKey);
  void retitle(agentId, sessionKey)
    .catch((err) => console.error(`[session-titles] ${sessionKey}:`, err instanceof Error ? err.message : err))
    .finally(() => inflight.delete(sessionKey));
}

export function sanitizeTitle(raw: string): string {
  let t = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)[0] ?? "";
  t = t.replace(/^(title|session|topic)\s*:\s*/i, "").replace(/^["'“”‘’`*#\-\s]+|["'“”‘’`*.\s]+$/g, "").trim();
  if (t.length > MAX_TITLE_CHARS) t = t.slice(0, MAX_TITLE_CHARS).replace(/\s+\S*$/, "").trim();
  return t;
}

interface HistoryMessage {
  role?: string;
  content?: unknown;
}

async function recentTurns(client: Awaited<ReturnType<typeof gatewayClientFor>>, sessionKey: string) {
  const r = (await client.call("chat.history", { sessionKey, limit: 24 })) as { messages?: HistoryMessage[] };
  const bubbles = transcriptToBubbles((r.messages ?? []) as never[]);
  return bubbles.filter((b) => (b.role === "user" || b.role === "assistant") && (b.text ?? "").trim());
}

async function retitle(agentId: string, sessionKey: string): Promise<void> {
  const settings = readInferenceSettings();
  if (!settings.url) return;
  const client = await gatewayClientFor(agentId);

  // Wait for the reply to the turn that triggered us: the last message with
  // text must be an assistant message that is no longer streaming.
  const deadline = Date.now() + REPLY_WAIT_MS;
  let turns: Awaited<ReturnType<typeof recentTurns>> = [];
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    turns = await recentTurns(client, sessionKey);
    const last = turns[turns.length - 1];
    if (last && last.role === "assistant" && !last.streaming) break;
  }
  if (turns.length < 2) return;

  const transcript = turns
    .slice(-8)
    .map((b) => `${b.role === "user" ? "Customer/user" : "Assistant"}: ${(b.text ?? "").replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");
  const messages = [
    {
      role: "system",
      content:
        "You name chat sessions for a sidebar. Reply with ONLY the title: 3 to 6 words, plain text, no quotes, no trailing period. Name the topic or task (e.g. 'Order #1221 missing lancets', 'Trace order to NetSuite'), never the participants or the word 'conversation'.",
    },
    { role: "user", content: transcript },
  ];
  // No reasoning flag: with `reasoning_effort` set, Gemma 4 spends the whole
  // budget thinking and returns empty content (seen 2026-10-07). A plain
  // request answers in ~10 tokens. If content still comes back empty, retry
  // once with the chat template's thinking switched off.
  const ask = async (extra: Record<string, unknown>): Promise<string> => {
    const res = await fetch(`${settings.url!.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: settings.modelId, messages, temperature: 0.2, ...extra }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`inference ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }> };
    return sanitizeTitle(json.choices?.[0]?.message?.content ?? "");
  };
  let title = await ask({ max_tokens: 64 });
  if (!title) title = await ask({ max_tokens: 400, chat_template_kwargs: { enable_thinking: false } });
  if (!title) {
    console.warn(`[session-titles] ${sessionKey}: model returned no title text`);
    return;
  }
  console.log(`[session-titles] ${sessionKey} → "${title}"`);

  try {
    await client.call("sessions.patch", { key: sessionKey, label: title });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Labels are unique per agent on the gateway; make it unique and retry once.
    if (/already in use/i.test(msg)) {
      await client.call("sessions.patch", { key: sessionKey, label: `${title} (${sessionKey.slice(-4)})` });
      return;
    }
    throw err;
  }
}
