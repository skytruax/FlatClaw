"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRouter, useSearchParams } from "next/navigation";
import { Send, Square, Sparkles, MessageSquarePlus, Paperclip, X, FileText, Upload } from "lucide-react";
import CompactionControls, {
  CompactionMarker,
  type CompactionCheckpoint,
} from "./CompactionControls";

interface ToolEvent {
  id: string;
  name: string;
  args?: unknown;
  result?: string;
  error?: string;
  status: "pending" | "done" | "failed";
}

/** An attachment shown in a sent bubble (image thumb / file chip). */
interface BubbleAttachment {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

interface ChatBubble {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoning?: string;
  tools: ToolEvent[];
  streaming?: boolean;
  timestamp: number;
  attachments?: BubbleAttachment[];
}

/** A file staged in the composer before send. */
interface ComposerAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  /** data:<mime>;base64,<...> — used for preview and as the base64 source on send. */
  dataUrl: string;
  sizeBytes: number;
}

/** Accept list mirrors openclaw's chat (images, audio, pdf, text, office docs, zip). */
const ATTACH_ACCEPT =
  "image/*,audio/*,application/pdf,text/*,.csv,.json,.md,.txt,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx";
/** openclaw's default per-attachment cap (DEFAULT_CHAT_ATTACHMENT_MAX_MB). */
const ATTACH_MAX_BYTES = 20 * 1024 * 1024;

/** Split a data URL into its mime + bare base64 (no prefix) — the shape openclaw's chat.send wants. */
function splitDataUrl(dataUrl: string): { mimeType: string; content: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  return m ? { mimeType: m[1], content: m[2] } : null;
}

interface ChatPanelProps {
  targetUserId: string;
  agentId: string;
  identityName: string;
  /**
   * Session to render. When this changes the panel re-hydrates from
   * `chat.history`. Defaults to the agent's main session.
   */
  sessionKey?: string;
}

function uuid(): string {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Interleave compaction markers into a sorted bubble list. A checkpoint is
 * inserted between bubble[i] and bubble[i+1] when its `createdAt` falls in
 * the interval (bubble[i].timestamp, bubble[i+1].timestamp]. Checkpoints
 * older than the first bubble are dropped (the corresponding history was
 * compacted away — no point pointing at a void). Checkpoints newer than
 * the last bubble are pinned at the end.
 *
 * Multiple checkpoints in the same slot stack chronologically.
 */
/**
 * Estimate tokens consumed by the live transcript using openclaw's own
 * chars/4 heuristic (see openclaw/src/agents/pi-embedded-runner/
 * tool-result-truncation.ts:220). Counts user/assistant text, reasoning
 * blocks, tool args, and tool results — everything that ends up in the
 * model's context on the next turn.
 */
const estimateTranscriptTokens = (bubbles: ChatBubble[]): number => {
  let chars = 0;
  for (const b of bubbles) {
    chars += (b.text?.length ?? 0) + (b.reasoning?.length ?? 0);
    for (const t of b.tools) {
      chars += t.name.length;
      if (t.args) chars += JSON.stringify(t.args).length;
      if (t.result) chars += t.result.length;
      if (t.error) chars += t.error.length;
    }
  }
  return Math.ceil(chars / 4);
};

/**
 * Compose the live usage snapshot the chat header renders. Combines:
 *   - openclaw's authoritative `totalTokens` (if non-zero — paid providers)
 *   - or `staticPromptTokens` (system + tools + workspace files)
 *     + transcript estimate (live, refreshes every render)
 *
 * The result updates on every bubble change without waiting for the
 * gateway's 30s sessions.usage cache to expire. On free providers the
 * meter is "fresh" in spirit even though the gateway reports zero
 * cumulative tokens.
 */
const composeLiveUsage = (
  base: {
    totalTokens: number | null;
    totalTokensFresh: boolean;
    contextTokens: number | null;
    compactionCheckpointCount: number;
  },
  staticPromptTokens: number | null,
  bubbles: ChatBubble[],
) => {
  if (base.totalTokens != null && base.totalTokens > 0) {
    return base;
  }
  const transcript = estimateTranscriptTokens(bubbles);
  // Prefer staticPromptTokens (system + tools + injected workspace files,
  // from the gateway's contextWeight) + transcript. If the gateway hasn't
  // surfaced a contextWeight yet (fresh session, or its 30s sessions.usage
  // cache still holds a pre-turn entry), fall back to the transcript-only
  // estimate so the meter shows *something* (underreports the ~25-40k static
  // prompt, but converges once a refresh lands) rather than "—". Only null
  // when there's genuinely nothing in context yet.
  const total =
    staticPromptTokens != null
      ? staticPromptTokens + transcript
      : transcript > 0
        ? transcript
        : null;
  return {
    ...base,
    totalTokens: total,
    totalTokensFresh: false, // signal to UI: tilde + "estimate"
  };
};

type TranscriptItem =
  | { kind: "bubble"; bubble: ChatBubble }
  | { kind: "marker"; checkpoint: CompactionCheckpoint };

function interleaveBubblesAndMarkers(
  bubbles: ChatBubble[],
  checkpoints: CompactionCheckpoint[],
): TranscriptItem[] {
  if (checkpoints.length === 0)
    return bubbles.map((b) => ({ kind: "bubble" as const, bubble: b }));
  const sortedCheckpoints = [...checkpoints].sort((a, b) => a.createdAt - b.createdAt);
  const out: TranscriptItem[] = [];
  let cpIdx = 0;
  // Skip checkpoints older than the first bubble.
  if (bubbles.length > 0) {
    while (
      cpIdx < sortedCheckpoints.length &&
      sortedCheckpoints[cpIdx].createdAt < bubbles[0].timestamp
    ) {
      cpIdx++;
    }
  }
  for (let i = 0; i < bubbles.length; i++) {
    out.push({ kind: "bubble", bubble: bubbles[i] });
    const nextTs = i < bubbles.length - 1 ? bubbles[i + 1].timestamp : Infinity;
    while (
      cpIdx < sortedCheckpoints.length &&
      sortedCheckpoints[cpIdx].createdAt <= nextTs
    ) {
      out.push({ kind: "marker", checkpoint: sortedCheckpoints[cpIdx] });
      cpIdx++;
    }
  }
  // If there were no bubbles but checkpoints exist (rare — fresh restore),
  // surface them at the top.
  if (bubbles.length === 0) {
    for (const cp of sortedCheckpoints) {
      out.push({ kind: "marker", checkpoint: cp });
    }
  }
  return out;
}

/**
 * Strips chat-template / tool-call protocol artifacts that occasionally
 * leak into assistant text when a model emits a slightly malformed
 * delimiter that openclaw's parser doesn't recognize. The patterns below
 * cover Gemma's `<tool_call>` envelope plus a few common ChatML / Harmony
 * variants that show up in mixed model deployments:
 *
 *   <tool_call>...</tool_call>     — Gemma's tool block
 *   <tool_call|>                   — malformed Gemma variant we've seen leak
 *   <|tool_call|>...<|/tool_call|> — pipe-delimited variant
 *   <|im_start|> / <|im_end|>      — ChatML-style turn markers
 *   <|start|>...<|end|>            — Harmony-style markers
 *   <|channel|>commentary          — Harmony channel markers
 *   <think>...</think>             — pre-stripped reasoning blocks
 *
 * Matched paired tags get their inner content removed too — the actual
 * tool-call payload gets surfaced through proper tool-event channels, so
 * the inline JSON is redundant noise. Bare/orphan tags are just deleted.
 */
function sanitizeAssistantText(raw: string): string {
  if (!raw) return raw;
  let t = raw;
  // Paired tool-call envelopes (with content) — remove the whole block.
  t = t.replace(/<\|?tool_call\|?>[\s\S]*?<\|?\/?tool_call\|?>/g, "");
  // Bare / malformed openers that didn't get closed.
  t = t.replace(/<\|?\/?tool_call\|?>/g, "");
  // ChatML / Harmony turn markers.
  t = t.replace(/<\|im_start\|>[\s\S]*?(?=<\|im_end\|>|$)/g, "");
  t = t.replace(/<\|im_end\|>/g, "");
  t = t.replace(/<\|start\|>[\s\S]*?<\|end\|>/g, "");
  t = t.replace(/<\|(start|end|channel|message|return|constrain)\|>/g, "");
  // Pre-stripped reasoning blocks (we render reasoning separately).
  t = t.replace(/<think>[\s\S]*?<\/think>/g, "");
  t = t.replace(/<\/?think>/g, "");
  // Collapse any blank lines we just opened up.
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

export default function ChatPanel({
  targetUserId,
  agentId,
  identityName,
  sessionKey: sessionKeyProp,
}: ChatPanelProps) {
  const sessionKey = sessionKeyProp ?? `agent:${agentId}:main`;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [input, setInput] = useState("");
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [hydrating, setHydrating] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [streamStatus, setStreamStatus] = useState<"connecting" | "live" | "error">(
    "connecting",
  );
  const [streamError, setStreamError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  // (The per-turn thinking-level picker is hidden for now — every turn runs
  // at the agent's configured default, "medium" on prod. The `thinking` param
  // is still wired through `/api/runtime/chat-send` if we re-add the dropdown.)
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  // Tracks the most recent message count we've hydrated. The heartbeat uses
  // this to detect a drift between our local state and what's on disk (e.g.
  // someone else wrote to this session via the openclaw control UI) and
  // re-hydrate when that happens, instead of refetching on every tick.
  const hydratedCountRef = useRef(0);
  // Wall-clock of the last stream event accepted for the rendered session.
  // The heartbeat uses it to detect a run that died without a terminal event
  // (gateway restart mid-turn, dropped SSE final frame) and recover, instead
  // of pinning a streaming bubble — and the "thinking…" indicator — forever.
  const lastStreamActivityRef = useRef(0);

  // ── compaction state ──────────────────────────────────────────────────
  const [checkpoints, setCheckpoints] = useState<CompactionCheckpoint[]>([]);
  // Static prompt cost (system + tools + workspace files), char-based.
  // Refreshed by the usage route. Cached by openclaw for 30 s but the
  // numbers it reports don't change between turns anyway — these
  // components are fixed for a given agent config.
  const [staticPromptTokens, setStaticPromptTokens] = useState<number | null>(
    null,
  );
  const [usage, setUsage] = useState<{
    totalTokens: number | null;
    totalTokensFresh: boolean;
    contextTokens: number | null;
    compactionCheckpointCount: number;
  }>({
    totalTokens: null,
    totalTokensFresh: false,
    contextTokens: null,
    compactionCheckpointCount: 0,
  });

  const refreshCompaction = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/portal/sessions/${encodeURIComponent(sessionKey)}/compaction`,
        { cache: "no-store" },
      );
      if (r.ok) {
        const data = (await r.json()) as { checkpoints?: CompactionCheckpoint[] };
        setCheckpoints(data.checkpoints ?? []);
      }
    } catch {
      /* best effort */
    }
    // Pull live token usage + context-weight from the per-session usage
    // route. The gateway's sessions.list doesn't expose totalTokens — that
    // lives behind sessions.usage with includeContextWeight=true.
    // estimatedPromptTokens is a deterministic char/4 estimate of what
    // openclaw measured as actively in the prompt this turn (system +
    // tools + injected workspace files); we use it as the meter numerator
    // when totalTokens is unavailable (free provider / pre-first-turn).
    try {
      const r = await fetch(
        `/api/portal/sessions/${encodeURIComponent(sessionKey)}/usage`,
        { cache: "no-store" },
      );
      if (r.ok) {
        const u = (await r.json()) as {
          totalTokens: number | null;
          contextTokens: number | null;
          estimatedPromptTokens: number | null;
          checkpointCount: number;
        };
        setStaticPromptTokens(u.estimatedPromptTokens);
        setUsage({
          totalTokens: u.totalTokens, // null on free providers; transcript counted client-side
          totalTokensFresh: u.totalTokens != null,
          contextTokens: u.contextTokens,
          compactionCheckpointCount: u.checkpointCount,
        });
      }
    } catch {
      /* best effort */
    }
  }, [sessionKey]);

  // Ref so the SSE event handler (created in a useEffect that only re-runs
  // on agentId) can call the latest refreshCompaction without retaking the
  // EventSource connection on every sessionKey change.
  const refreshCompactionRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    refreshCompactionRef.current = refreshCompaction;
  }, [refreshCompaction]);

  useEffect(() => {
    void refreshCompaction();
  }, [refreshCompaction]);

  // ── hydrate from history on session change + heartbeat poll ────────────
  useEffect(() => {
    let cancelled = false;
    const load = async (force: boolean) => {
      try {
        const r = await fetch(
          `/api/portal/sessions/${encodeURIComponent(sessionKey)}/history`,
          { cache: "no-store" },
        );
        if (!r.ok) return;
        const data = (await r.json()) as {
          bubbles?: ChatBubble[];
          messageCount?: number;
        };
        if (cancelled) return;
        // Skip if our local state is already up to date and nothing's
        // streaming. This keeps the heartbeat cheap and avoids overwriting
        // an in-flight assistant bubble.
        const isStreaming = bubblesRef.current.some((b) => b.streaming);
        // A run gone quiet for too long without a terminal event — gateway
        // restart mid-turn, or an SSE reconnect that dropped the final frame
        // (webchat 1006/1012) — would otherwise pin the "thinking…" indicator
        // (and any streaming bubble) forever, and the isStreaming guard below
        // would keep the heartbeat from re-hydrating. Recover on staleness.
        // Covers BOTH: a pinned streaming bubble, AND an `activeRunId` with no
        // streaming bubble (an all-tool-call turn whose final frame dropped).
        // Only active-generation events refresh lastStreamActivity (see
        // applyEvent), so legitimately long, chatty tool calls keep this fresh
        // and this only trips on a genuinely dead run.
        const runActive = isStreaming || activeRunIdRef.current != null;
        const runStale =
          runActive && Date.now() - lastStreamActivityRef.current > 15_000;
        if (!force && !runStale) {
          if (isStreaming) return;
          if ((data.messageCount ?? 0) === hydratedCountRef.current) return;
        }
        hydratedCountRef.current = data.messageCount ?? 0;
        setBubbles((data.bubbles ?? []) as ChatBubble[]);
        if (runStale) setActiveRunId(null);
      } catch {
        // best-effort — heartbeat will try again
      }
    };
    setHydrating(true);
    void load(true).finally(() => {
      if (!cancelled) setHydrating(false);
    });
    // Heartbeat: re-hydrate the transcript every 6 s, and refresh the token
    // meter every 12 s (every other tick). The SSE `chat`/`sessions.changed`
    // events also trigger a usage refresh, but they can land on the gateway's
    // 30 s sessions.usage cache (stale, pre-turn) — the heartbeat guarantees
    // the meter catches up within a tick or two of any turn finishing,
    // regardless of whether the SSE final event was delivered.
    let tick = 0;
    const t = setInterval(() => {
      void load(false);
      if (++tick % 2 === 0) void refreshCompactionRef.current?.();
    }, 6_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  // Mirror bubbles + sessionKey into refs so the heartbeat and the SSE
  // event handler can read the latest values without being recreated each
  // render (the SSE useEffect re-runs only on agentId).
  const bubblesRef = useRef<ChatBubble[]>([]);
  useEffect(() => {
    bubblesRef.current = bubbles;
  }, [bubbles]);
  const sessionKeyRef = useRef(sessionKey);
  useEffect(() => {
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);
  // So the heartbeat's stale-run recovery can see whether a run is still
  // "active" (the thinking indicator) without retaking the EventSource.
  const activeRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  // ── stream subscription ────────────────────────────────────────────────
  useEffect(() => {
    const url = `/api/runtime/stream?agent=${encodeURIComponent(agentId)}`;
    const es = new EventSource(url);
    es.addEventListener("ready", () => setStreamStatus("live"));
    es.addEventListener("runtime.error", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data || "{}");
      setStreamError(data.error ?? "unknown");
      setStreamStatus("error");
    });
    es.addEventListener("error", () => setStreamStatus("error"));

    const onAny = (eventName: string) => (ev: MessageEvent) => {
      try {
        applyEvent(eventName, JSON.parse(ev.data));
      } catch {
        // ignore non-JSON heartbeats
      }
    };
    // Real openclaw event names emitted to broadcast subscribers:
    //  - "chat":             assistant text (state=delta|final|aborted|error)
    //  - "agent":            agent run/tool stream events
    //  - "session.tool":     per-session tool lifecycle (start/result)
    //  - "sessions.changed": session metadata changes (compaction, label,
    //                        message count, etc.). Our compaction handler
    //                        reacts to reason="compact".
    ["chat", "agent", "session.tool", "session.message", "sessions.changed"].forEach(
      (name) => es.addEventListener(name, onAny(name)),
    );

    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const applyEvent = useCallback((eventName: string, evt: unknown) => {
    if (!evt || typeof evt !== "object") return;
    const e = evt as Record<string, unknown>;

    // The SSE stream forwards every event for this agent — including events
    // for *other* sessions of the same agent. Ignore anything that isn't
    // for the session we're currently rendering. (Events without a
    // sessionKey are connection-level — let those through.)
    const evtSessionKey = typeof e.sessionKey === "string" ? e.sessionKey : null;
    if (evtSessionKey && evtSessionKey !== sessionKeyRef.current) return;

    // Only ACTIVE-GENERATION events count as run activity for the heartbeat's
    // stale-run recovery: assistant text (`chat`), the agent run/tool stream
    // (`agent`), and tool lifecycle (`session.tool`). Post-turn metadata —
    // `sessions.changed` (compaction / async index-sync) and the finalized
    // `session.message` — must NOT refresh the timer, or a dropped terminal
    // frame leaves the "thinking…" indicator pinned forever while harmless
    // post-turn events keep resetting the staleness clock.
    if (
      evtSessionKey === sessionKeyRef.current &&
      (eventName === "chat" ||
        eventName === "agent" ||
        eventName === "session.tool")
    ) {
      lastStreamActivityRef.current = Date.now();
    }

    // The "chat" event carries assistant text. Payload shape:
    //   { runId, sessionKey, seq, state: "delta"|"final"|..., message: {
    //       role, content: [{ type: "text", text: <full accumulated> }, ...]
    //   }}
    // Note: text is the FULL accumulated text so far, not a delta chunk —
    // we replace, not append.
    if (eventName === "chat") {
      const state = String(e.state ?? "");
      const message = e.message as
        | { role?: string; content?: { type: string; text?: string }[] }
        | undefined;
      const blocks = Array.isArray(message?.content) ? message!.content : [];
      const textBlock = blocks.find((b) => b.type === "text");
      const reasoningBlock = blocks.find(
        (b) => b.type === "reasoning" || b.type === "thinking",
      );
      if (textBlock?.text) replaceAssistantText(textBlock.text, false);
      if (reasoningBlock?.text) replaceAssistantText(reasoningBlock.text, true);
      if (state === "final" || state === "aborted" || state === "error") {
        finalizeAssistant();
        // A completed turn means openclaw has (re)generated this session's
        // contextWeight — refresh the usage snapshot so the token meter
        // shows real numbers. The `sessions.changed` event *should* also
        // do this, but it doesn't always arrive before the run ends, so
        // we belt-and-braces it here.
        void refreshCompactionRef.current?.();
        // A turn often composes a held action (transfer/loan origination) or
        // writes files (reports, exports). Nudge the approvals and files tabs
        // to refetch immediately so their badge/queue/tree update the moment
        // the agent finishes — no manual refresh.
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("flatclaw:approvals-refresh"));
          window.dispatchEvent(new Event("flatclaw:files-refresh"));
        }
      }
      return;
    }

    // The "session.message" event carries finalized assistant messages —
    // the gateway emits this after a turn completes (and the run's text was
    // routed through tool calls instead of inline `chat` deltas, so the
    // final `chat` event came back without a message body). Treat it as a
    // *fallback* — only update text if the bubble is still streaming (i.e.
    // the inline `chat` deltas didn't deliver final text). Without this guard
    // we render the same assistant turn twice — once from the streamed
    // `chat` events, once from the post-turn `session.message`.
    if (eventName === "session.message") {
      const message = e.message as
        | {
            role?: string;
            content?: { type: string; text?: string }[];
          }
        | undefined;
      if (message?.role === "assistant") {
        const blocks = Array.isArray(message.content) ? message.content : [];
        const textBlock = blocks.find((b) => b.type === "text");
        // Hoist to a local const so it's narrowed to `string` inside the
        // setBubbles closure (TS doesn't carry object-property narrowing
        // across function boundaries).
        const finalText = textBlock?.text;
        if (finalText) {
          setBubbles((prev) => {
            const last = prev[prev.length - 1];
            // Only fill text if the last bubble is an empty streaming
            // assistant — i.e. the chat-delta path didn't populate it.
            if (
              last?.role === "assistant" &&
              last.streaming &&
              !last.text
            ) {
              const cleaned = sanitizeAssistantText(finalText);
              return [...prev.slice(0, -1), { ...last, text: cleaned }];
            }
            return prev;
          });
        }
        finalizeAssistant();
      }
      return;
    }

    // sessions.changed fires when any session metadata mutates; we care
    // about compaction completion (reason="compact") and metadata refreshes
    // that include compactionCheckpointCount or totalTokens. Refresh both
    // checkpoint list + usage snapshot. notifyUser=true on the gateway side
    // makes the compaction reasons surface here.
    if (eventName === "sessions.changed") {
      const reason = String(e.reason ?? "");
      const evtKey = typeof e.sessionKey === "string" ? e.sessionKey : null;
      if (evtKey && evtKey !== sessionKeyRef.current) return;
      // A finished run carries endedAt (status done/timeout/error). Use it as
      // a secondary finalize signal in case the terminal `chat` frame was
      // missed (e.g. dropped during an SSE reconnect).
      if (e.endedAt != null) finalizeAssistant();
      // For non-compact reasons we don't need to refresh checkpoints, but we
      // do want to keep the token meter current — usage refresh is cheap.
      if (
        reason === "compact" ||
        reason === "checkpoint-restore" ||
        reason === "checkpoint-branch"
      ) {
        void refreshCompactionRef.current?.();
      } else {
        // Throttled token-meter refresh for other reasons (send/abort/patch).
        void refreshCompactionRef.current?.();
      }
      return;
    }

    // The "agent" event carries tool lifecycle and other agent stream events.
    if (eventName === "agent" || eventName === "session.tool") {
      const stream = String(e.stream ?? "");
      const data = (e.data as Record<string, unknown> | undefined) ?? {};
      if (stream === "tool" || stream === "exec") {
        const phase = String(data.phase ?? "");
        const toolId = String(data.toolCallId ?? data.id ?? data.callId ?? uuid());
        const name = String(data.name ?? data.tool ?? "tool");
        if (phase === "start" || phase === "started") {
          attachTool({
            id: toolId,
            name,
            args: data.params ?? data.arguments ?? data.input,
            status: "pending",
          });
        } else if (phase === "end" || phase === "result" || phase === "complete") {
          const raw = data.output ?? data.result;
          const result =
            typeof raw === "string"
              ? raw
              : raw === undefined
                ? undefined
                : JSON.stringify(raw, null, 2);
          const errRaw = data.error;
          const errStr =
            typeof errRaw === "string"
              ? errRaw
              : errRaw == null
                ? undefined
                : JSON.stringify(errRaw, null, 2);
          updateTool(toolId, {
            status: errStr ? "failed" : "done",
            result,
            error: errStr,
          });
        }
      }
      return;
    }
  }, []);

  const replaceAssistantText = useCallback((fullText: string, isReasoning: boolean) => {
    const cleaned = sanitizeAssistantText(fullText);
    setBubbles((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant") {
        // Update the tail assistant bubble when this frame belongs to the SAME
        // turn — either it's still streaming, or it was just finalized and this
        // frame continues its content. The gateway races the terminal `chat`
        // frame against `session.message`/`sessions.changed` (which set
        // streaming:false); if the bubble finalized first, a trailing `chat`
        // frame must merge in place, NOT append a duplicate of the same turn.
        // `chat` carries the FULL accumulated text, so "continues" = one string
        // is a prefix of the other.
        const continuesText =
          !isReasoning &&
          typeof last.text === "string" &&
          (cleaned.startsWith(last.text) || last.text.startsWith(cleaned));
        const continuesReasoning =
          isReasoning &&
          typeof last.reasoning === "string" &&
          last.reasoning.length > 0 &&
          (cleaned.startsWith(last.reasoning) || last.reasoning.startsWith(cleaned));
        if (last.streaming || continuesText || continuesReasoning) {
          const updated: ChatBubble = isReasoning
            ? { ...last, reasoning: cleaned }
            : { ...last, text: cleaned };
          return [...prev.slice(0, -1), updated];
        }
      }
      const fresh: ChatBubble = {
        id: uuid(),
        role: "assistant",
        text: isReasoning ? "" : cleaned,
        reasoning: isReasoning ? cleaned : undefined,
        tools: [],
        streaming: true,
        timestamp: Date.now(),
      };
      return [...prev, fresh];
    });
  }, []);

  const attachTool = useCallback((tool: ToolEvent) => {
    setBubbles((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && last.streaming) {
        // Dedupe by id: the same tool-call lands here twice when it's
        // broadcast on both the run-scoped `agent` channel and the
        // session-scoped `session.tool` channel. Merge instead of appending
        // — otherwise React trips on duplicate keys.
        const existing = last.tools.find((t) => t.id === tool.id);
        const tools = existing
          ? last.tools.map((t) => (t.id === tool.id ? { ...t, ...tool } : t))
          : [...last.tools, tool];
        return [...prev.slice(0, -1), { ...last, tools }];
      }
      return [
        ...prev,
        {
          id: uuid(),
          role: "assistant",
          text: "",
          tools: [tool],
          streaming: true,
          timestamp: Date.now(),
        },
      ];
    });
  }, []);

  const updateTool = useCallback((toolId: string, patch: Partial<ToolEvent>) => {
    setBubbles((prev) =>
      prev.map((b) => ({
        ...b,
        tools: b.tools.map((t) => (t.id === toolId ? { ...t, ...patch } : t)),
      })),
    );
  }, []);

  const finalizeAssistant = useCallback(() => {
    setActiveRunId(null);
    setBubbles((prev) =>
      prev.map((b, i) =>
        i === prev.length - 1 && b.role === "assistant" ? { ...b, streaming: false } : b,
      ),
    );
  }, []);

  // ── scroll-to-bottom on new content ───────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [bubbles]);

  // ── auto-grow composer ────────────────────────────────────────────────
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // ── attachments (drop / paste / pick files & images) ─────────────────
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  // Drag events bubble from children, so a single boolean flickers as the
  // cursor crosses descendant elements. Count enter/leave to know when the
  // drag has truly left the whole panel.
  const dragDepth = useRef(0);
  const dragHasFiles = (e: DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes("Files");

  const addFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (file.size > ATTACH_MAX_BYTES) {
        console.warn(
          `[chat] skipped ${file.name} — ${(file.size / 1048576).toFixed(1)}MB exceeds the 20MB limit`,
        );
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        if (!dataUrl.startsWith("data:")) return;
        setAttachments((prev) => [
          ...prev,
          {
            id: uuid(),
            fileName: file.name || "file",
            mimeType: file.type || "application/octet-stream",
            dataUrl,
            sizeBytes: file.size,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // ── send / abort ──────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const message = input.trim();
    const staged = attachments;
    if ((!message && staged.length === 0) || sending) return;
    const idempotencyKey = uuid();
    setSending(true);
    setActiveRunId(idempotencyKey);
    lastStreamActivityRef.current = Date.now();
    setBubbles((prev) => [
      ...prev,
      {
        id: uuid(),
        role: "user",
        text: message,
        tools: [],
        timestamp: Date.now(),
        attachments: staged.map((a) => ({
          fileName: a.fileName,
          mimeType: a.mimeType,
          dataUrl: a.dataUrl,
        })),
      },
    ]);
    setInput("");
    setAttachments([]);

    // Strip the `data:` prefix → bare base64, the shape openclaw's chat.send wants.
    const apiAttachments = staged
      .map((a) => {
        const parsed = splitDataUrl(a.dataUrl);
        if (!parsed) return null;
        return {
          type: parsed.mimeType.startsWith("image/") ? "image" : "file",
          mimeType: parsed.mimeType,
          fileName: a.fileName,
          content: parsed.content,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    try {
      const r = await fetch("/api/runtime/chat-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId,
          message,
          idempotencyKey,
          sessionKey,
          ...(apiAttachments.length ? { attachments: apiAttachments } : {}),
        }),
      });
      const json = await r.json();
      if (!r.ok || json.ok === false) {
        setBubbles((prev) => [
          ...prev,
          {
            id: uuid(),
            role: "assistant",
            text: `[error: ${json.error ?? r.status}]`,
            tools: [],
            timestamp: Date.now(),
          },
        ]);
        setActiveRunId(null);
      }
    } catch (err) {
      setBubbles((prev) => [
        ...prev,
        {
          id: uuid(),
          role: "assistant",
          text: `[error: ${err instanceof Error ? err.message : String(err)}]`,
          tools: [],
          timestamp: Date.now(),
        },
      ]);
      setActiveRunId(null);
    } finally {
      setSending(false);
    }
  }, [input, attachments, sending, targetUserId, sessionKey]);

  const abort = useCallback(async () => {
    if (!activeRunId) return;
    await fetch("/api/runtime/chat-abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId, runId: activeRunId }),
    }).catch(() => undefined);
    finalizeAssistant();
  }, [activeRunId, targetUserId, finalizeAssistant]);

  return (
    <div
      className="relative flex flex-col h-[75vh] rounded-xl bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] overflow-hidden shadow-sm"
      onDragEnter={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragActive(true);
      }}
      onDragOver={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragActive(false);
      }}
      onDrop={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragActive(false);
        if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
      }}
    >
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-[hsl(var(--fc-bg-surface))/0.82] backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-[hsl(var(--brand-accent))] bg-[hsl(var(--fc-bg-soft))/0.9] px-10 py-8 shadow-lg">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[hsl(var(--brand-accent))/0.15]">
              <Upload className="h-7 w-7 text-[hsl(var(--brand-accent))]" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-[hsl(var(--fc-fg-primary))]">
                Drop files to attach
              </p>
              <p className="mt-0.5 text-xs text-[hsl(var(--fc-fg-muted))]">
                Images, PDFs, CSVs, documents — up to 20MB each
              </p>
            </div>
          </div>
        </div>
      )}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-[hsl(var(--fc-bg-tertiary))] bg-gradient-to-r from-[hsl(var(--fc-bg-soft))] to-[hsl(var(--fc-bg-surface))]">
        <div className="flex items-center gap-2.5 text-sm min-w-0">
          <Sparkles className="w-4 h-4 text-[hsl(var(--brand-accent))] shrink-0" />
          <span className="truncate">
            <span className="font-semibold">{identityName}</span>
            <span className="text-[hsl(var(--fc-fg-muted))] ml-1.5 font-mono text-xs">
              {agentId}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CompactionControls
            sessionKey={sessionKey}
            usage={composeLiveUsage(usage, staticPromptTokens, bubbles)}
            checkpoints={checkpoints}
            onRefresh={() => void refreshCompaction()}
          />
          <span
            className={
              "text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full " +
              (streamStatus === "live"
                ? "bg-[hsl(var(--brand-accent))/0.18] text-[hsl(var(--brand-accent))]"
                : streamStatus === "error"
                  ? "bg-red-100 text-red-700"
                  : "bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-secondary))]")
            }
          >
            {streamStatus === "live"
              ? "● live"
              : streamStatus === "error"
                ? "error"
                : "connecting"}
          </span>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
        {bubbles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-sm text-[hsl(var(--fc-fg-muted))]">
            <Sparkles className="w-6 h-6 text-[hsl(var(--brand-accent))/0.6] mb-2" />
            <p className="font-medium text-[hsl(var(--fc-fg-secondary))]">
              Chatting as {identityName}
            </p>
            <p className="text-[11px] mt-1 max-w-xs">
              Files in the workspace on the left are accessible to the agent.
            </p>
          </div>
        ) : (
          interleaveBubblesAndMarkers(bubbles, checkpoints).map((item) =>
            item.kind === "marker" ? (
              <CompactionMarker
                key={`cp:${item.checkpoint.checkpointId}`}
                checkpoint={item.checkpoint}
              />
            ) : (
              <Bubble
                key={item.bubble.id}
                bubble={item.bubble}
                identityName={identityName}
              />
            ),
          )
        )}
        {activeRunId && (
          <div className="flex items-center gap-2 text-xs text-[hsl(var(--fc-fg-muted))] pl-11">
            <TypingDots />
            <span>thinking…</span>
            <button
              type="button"
              onClick={abort}
              className="ml-2 inline-flex items-center gap-1 text-red-600 hover:underline"
            >
              <Square className="w-3 h-3" />
              stop
            </button>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex flex-col gap-2 p-3 border-t border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-soft))]"
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 rounded-lg border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-surface))] p-1 pr-2 text-xs"
              >
                {a.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.dataUrl}
                    alt={a.fileName}
                    className="h-10 w-10 rounded object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-secondary))]">
                    <FileText className="h-5 w-5" />
                  </span>
                )}
                <span className="max-w-[10rem] truncate text-[hsl(var(--fc-fg-secondary))]">
                  {a.fileName}
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  aria-label={`Remove ${a.fileName}`}
                  className="ml-0.5 rounded-full p-0.5 text-[hsl(var(--fc-fg-muted))] hover:bg-[hsl(var(--fc-bg-tertiary))] hover:text-[hsl(var(--fc-fg-primary))]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACH_ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach files or images"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-surface))] text-[hsl(var(--fc-fg-secondary))] hover:text-[hsl(var(--brand-accent))] hover:border-[hsl(var(--brand-accent))] transition-colors"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <textarea
            ref={composerRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const f = e.clipboardData?.files;
              if (f && f.length) {
                e.preventDefault();
                addFiles(f);
              }
            }}
            rows={1}
            placeholder={`Send as ${identityName}…  ·  drop or paste files`}
            className="flex-1 resize-none rounded-lg border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-surface))] px-3 py-2 text-sm leading-6 max-h-[200px] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-accent))/0.4] focus:border-[hsl(var(--brand-accent))]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            type="submit"
            disabled={sending || (!input.trim() && attachments.length === 0)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--brand-accent))] px-3.5 py-2 text-sm font-semibold text-[hsl(var(--brand-accent-fg))] hover:bg-[hsl(var(--brand-primary))] disabled:opacity-50 transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            {sending ? "Sending" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Bubble ────────────────────────────────────────────────────────────
function formatTime(ts: number | undefined | null): string {
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (isToday) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function UserAvatar() {
  return (
    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-secondary))] flex items-center justify-center">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    </div>
  );
}

function FlatclawAvatar() {
  return (
    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[hsl(var(--brand-primary))] flex items-center justify-center text-[hsl(var(--brand-accent-fg))]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/branding/mark.svg" alt="FlatClaw" className="w-5 h-5 invert brightness-0" style={{ filter: "invert(1) brightness(2)" }} />
    </div>
  );
}

function Bubble({
  bubble,
  identityName,
}: {
  bubble: ChatBubble;
  identityName: string;
}) {
  const time = formatTime(bubble.timestamp);

  if (bubble.role === "user") {
    return (
      <div className="flex gap-3">
        <UserAvatar />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-xs font-semibold text-[hsl(var(--fc-fg-primary))]">
              {identityName}
            </span>
            {time && (
              <span className="text-[10px] text-[hsl(var(--fc-fg-muted))]">{time}</span>
            )}
          </div>
          {bubble.attachments && bubble.attachments.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-2">
              {bubble.attachments.map((a, i) =>
                a.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={a.dataUrl}
                    alt={a.fileName}
                    className="max-h-40 rounded-lg ring-1 ring-[hsl(var(--fc-bg-tertiary))]"
                  />
                ) : (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--fc-bg-soft))] px-2 py-1 text-xs text-[hsl(var(--fc-fg-secondary))] ring-1 ring-[hsl(var(--fc-bg-tertiary))]"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {a.fileName}
                  </span>
                ),
              )}
            </div>
          )}
          {bubble.text.trim().length > 0 && (
            <div className="rounded-lg px-3 py-2 text-sm whitespace-pre-wrap bg-[hsl(var(--fc-bg-soft))] text-[hsl(var(--fc-fg-primary))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] inline-block max-w-full">
              {bubble.text}
            </div>
          )}
        </div>
      </div>
    );
  }

  const hasReasoning = !!bubble.reasoning && bubble.reasoning.trim().length > 0;
  const hasTools = bubble.tools.length > 0;
  const hasText = bubble.text.trim().length > 0;

  return (
    <div className="flex gap-3">
      <FlatclawAvatar />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-xs font-semibold text-[hsl(var(--brand-primary))]">
            FlatClaw
          </span>
          {time && (
            <span className="text-[10px] text-[hsl(var(--fc-fg-muted))]">{time}</span>
          )}
          {bubble.streaming && (
            <span className="text-[10px] text-[hsl(var(--fc-fg-muted))]">
              · streaming
            </span>
          )}
        </div>
        <div className="space-y-2">
          {hasReasoning && <Reasoning text={bubble.reasoning!} />}
          {/* Tools render above the narration text. A live turn collapses the
              whole turn into one streaming bubble; the model runs its tool(s)
              first and then narrates the result, so text-above-tools would show
              the answer with the tool box floating below it. Ordering tools
              first matches that flow and the way openclaw splits the finalized
              transcript (tool message, then text message) on re-hydrate. */}
          {hasTools && <ToolList tools={bubble.tools} />}
          {hasText ? (
            <div
              className={[
                "prose prose-sm max-w-none",
                "text-[hsl(var(--fc-fg-primary))]",
                "prose-headings:text-[hsl(var(--fc-fg-primary))]",
                "prose-strong:text-[hsl(var(--fc-fg-primary))]",
                "prose-a:text-[hsl(var(--brand-accent))]",
                "prose-code:bg-[hsl(var(--fc-bg-tertiary))] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none",
                "prose-pre:bg-[hsl(var(--fc-bg-tertiary))] prose-pre:text-[hsl(var(--fc-fg-primary))]",
                "prose-ol:list-decimal prose-ul:list-disc",
                "prose-li:my-0.5",
                "prose-p:my-1.5",
              ].join(" ")}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{bubble.text}</ReactMarkdown>
            </div>
          ) : !hasReasoning && !hasTools && bubble.streaming ? (
            <TypingDots />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-soft))]"
    >
      <summary className="cursor-pointer text-xs text-[hsl(var(--fc-fg-secondary))] px-2 py-1 list-none flex items-center gap-1.5">
        <span className={"transition " + (open ? "rotate-90" : "")}>▸</span>
        Thinking
      </summary>
      <div className="px-2 pb-2 text-xs whitespace-pre-wrap text-[hsl(var(--fc-fg-secondary))]">
        {text}
      </div>
    </details>
  );
}

function ToolList({ tools }: { tools: ToolEvent[] }) {
  return (
    <div className="flex flex-col gap-1">
      {tools.map((t) => (
        <ToolRow key={t.id} tool={t} />
      ))}
    </div>
  );
}

function summarizeArgs(args: unknown): string {
  if (args == null) return "";
  if (typeof args === "string") return args.slice(0, 80);
  if (typeof args === "object") {
    const obj = args as Record<string, unknown>;
    // common shapes: { command }, { cmd }, { path }, { url }, single-arg objects
    const v =
      obj.command ?? obj.cmd ?? obj.path ?? obj.url ?? obj.query ?? obj.text;
    if (typeof v === "string") return v.slice(0, 80);
    return JSON.stringify(args).slice(0, 80);
  }
  return String(args).slice(0, 80);
}

/** Produces a one-line natural-language description of a tool invocation. */
function describeInvocation(name: string, args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const o = args as Record<string, unknown>;
  if (name === "exec" || name === "Bash") {
    const cmd = (o.command ?? o.cmd) as string | undefined;
    const wd = (o.workdir ?? o.cwd) as string | undefined;
    if (typeof cmd === "string") {
      return wd ? `\`${cmd}\` in \`${wd}\`` : `\`${cmd}\``;
    }
  }
  if (name === "Read" || name === "Write" || name === "Edit") {
    const p = (o.path ?? o.file) as string | undefined;
    if (typeof p === "string") return `\`${p}\``;
  }
  if (name === "WebFetch" || name === "WebSearch") {
    const u = (o.url ?? o.query) as string | undefined;
    if (typeof u === "string") return `\`${u}\``;
  }
  if (name === "gmail-send") {
    const to = o.to as string | undefined;
    const subject = o.subject as string | undefined;
    if (to) return subject ? `to ${to}: ${subject}` : `to ${to}`;
  }
  return null;
}

function ToolRow({ tool }: { tool: ToolEvent }) {
  const [open, setOpen] = useState(false);
  const isDone = tool.status === "done";
  const isFailed = tool.status === "failed";
  const hasDetail =
    tool.args !== undefined || !!tool.result || !!tool.error;
  const preview = summarizeArgs(tool.args);

  return (
    <div className="rounded border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-soft))] text-xs overflow-hidden">
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[hsl(var(--fc-bg-tertiary))/0.5] disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span
          className={
            "text-[hsl(var(--fc-fg-muted))] inline-block transition-transform " +
            (open ? "rotate-90" : "")
          }
        >
          ▸
        </span>
        <code className="font-mono font-medium text-[hsl(var(--fc-fg-primary))]">
          {tool.name}
        </code>
        {preview && (
          <span className="text-[hsl(var(--fc-fg-muted))] truncate font-mono">
            {preview}
          </span>
        )}
        <span
          className={
            "ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 " +
            (isFailed
              ? "bg-red-100 text-red-700"
              : isDone
                ? "bg-[hsl(var(--brand-accent))/0.18] text-[hsl(var(--brand-accent))]"
                : "bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-secondary))] animate-pulse")
          }
        >
          {isFailed ? "failed" : isDone ? "done" : "running"}
        </span>
      </button>
      {open && hasDetail && (
        <div className="border-t border-[hsl(var(--fc-bg-tertiary))] px-3 py-2.5 text-[11px] space-y-2.5 bg-[hsl(var(--fc-bg-primary))]">
          {(() => {
            const desc = describeInvocation(tool.name, tool.args);
            return desc ? (
              <p className="text-[hsl(var(--fc-fg-secondary))] leading-relaxed">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ children }) => <span>{children}</span>,
                    code: ({ children }) => (
                      <code className="font-mono bg-[hsl(var(--fc-bg-tertiary))] px-1 py-0.5 rounded text-[10.5px]">
                        {children}
                      </code>
                    ),
                  }}
                >
                  {desc}
                </ReactMarkdown>
              </p>
            ) : null;
          })()}

          {tool.args !== undefined && (
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-[hsl(var(--fc-fg-muted))] font-semibold mb-1">
                Tool input
              </div>
              <pre className="font-mono whitespace-pre-wrap break-words text-[hsl(var(--fc-fg-primary))] bg-[hsl(var(--fc-bg-soft))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] rounded-md px-2.5 py-2 max-h-60 overflow-auto leading-relaxed">
                {typeof tool.args === "string"
                  ? tool.args
                  : JSON.stringify(tool.args, null, 2)}
              </pre>
            </div>
          )}

          {tool.result && (
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-[hsl(var(--fc-fg-muted))] font-semibold mb-1">
                Tool output
              </div>
              <pre className="font-mono whitespace-pre-wrap break-words text-[hsl(var(--fc-fg-primary))] bg-[hsl(var(--fc-bg-soft))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] rounded-md px-2.5 py-2 max-h-80 overflow-auto leading-relaxed">
                {tool.result}
              </pre>
            </div>
          )}

          {tool.error && (
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-red-600 font-semibold mb-1">
                Error
              </div>
              <pre className="font-mono whitespace-pre-wrap break-words text-red-700 bg-red-50 ring-1 ring-red-200 rounded-md px-2.5 py-2 max-h-60 overflow-auto leading-relaxed">
                {tool.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <span aria-hidden className="inline-flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--fc-fg-muted))] opacity-60 animate-pulse"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
}
