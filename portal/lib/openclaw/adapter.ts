import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

/**
 * Minimal OpenClaw gateway client. One WS connection, request/response with
 * promise tracking, and an event subscription bus. No outbox, no reconnect
 * logic — those belong in a higher layer if needed.
 */

const DEFAULT_URL = "ws://127.0.0.1:18789";
// Gateway WS protocol version. Bumped 3 → 4 for openclaw 2026.5.19
// (MIN_CLIENT_PROTOCOL_VERSION = 4; the connect frame schema is unchanged —
// only the negotiated version drifted). Keep in lockstep with the pinned
// openclaw in version-pin.ts.
const DEFAULT_PROTOCOL_VERSION = 4;
// HMR canary — bumping this string forces module reload in dev mode.
const _BUILD_ID = "2026-04-30-1748";
void _BUILD_ID;

function readGatewayTokenFromConfig(): string | undefined {
  const path =
    process.env.PORTAL_OPENCLAW_CONFIG ?? `${homedir()}/.openclaw/openclaw.json`;
  try {
    const cfg = JSON.parse(readFileSync(path, "utf8")) as {
      gateway?: { auth?: { token?: string } };
    };
    return cfg.gateway?.auth?.token;
  } catch {
    return undefined;
  }
}

export type GatewayFrame =
  | { type: "event"; event: string; payload?: unknown; seq?: number }
  | { type: "res"; id: string; ok: boolean; payload?: unknown; error?: { code: string; message: string } }
  | { type: "req"; id: string; method: string; params?: unknown };

export type GatewayEventListener = (event: string, payload: unknown) => void;

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Errors that indicate the WebSocket dropped/wasn't established but the
 * gateway itself isn't *rejecting* the request — safe to retry once with a
 * fresh connection. Anything else (gateway error frames, schema rejections)
 * is the gateway's actual answer and must NOT be retried.
 */
function isTransientWsError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message;
  return (
    m === "gateway connection closed" ||
    m === "WebSocket was closed before the connection was established" ||
    m === "not connected" ||
    m.startsWith("gateway connect timeout") ||
    m.startsWith("gateway timeout:") || // call() timeout — gateway didn't answer
    m.startsWith("connect handshake timeout") ||
    /ECONNREFUSED|ECONNRESET|EPIPE/.test(m)
  );
}

/**
 * Errors the gateway *responds* with while it's mid-startup. These come back
 * as proper response frames (so they aren't WS-level transients) but still
 * mean "wait, try again." Used by waitUntilReady to keep polling.
 */
function isGatewayStartupError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message;
  return (
    /UNAVAILABLE/i.test(m) ||
    /gateway startup/i.test(m) ||
    /still starting/i.test(m) ||
    /not ready/i.test(m)
  );
}

export class OpenClawClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private connectingPromise: Promise<void> | null = null;
  private pending = new Map<string, PendingRequest>();
  private listeners = new Set<GatewayEventListener>();
  private heartbeat: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly url: string = process.env.PORTAL_GATEWAY_URL ?? DEFAULT_URL,
    private readonly token: string | undefined =
      process.env.PORTAL_GATEWAY_TOKEN ?? readGatewayTokenFromConfig(),
  ) {}

  isConnected(): boolean {
    return this.connected;
  }

  async connect(timeoutMs = 8000): Promise<void> {
    if (this.connected) return;
    if (this.connectingPromise) return this.connectingPromise;

    this.connectingPromise = new Promise<void>((resolve, reject) => {
      // Spoof the Origin header to match the gateway host. legacy-control-ui
      // profile rejects connects from foreign origins with "origin not allowed"
      // unless explicitly listed in gateway.controlUi.allowedOrigins.
      const origin = (() => {
        try {
          const u = new URL(this.url);
          const proto = u.protocol === "wss:" ? "https:" : "http:";
          const host = u.hostname === "0.0.0.0" ? "localhost" : u.hostname;
          return `${proto}//${host}${u.port ? `:${u.port}` : ""}`;
        } catch {
          return "http://localhost:18789";
        }
      })();
      const ws = new WebSocket(this.url, { headers: { Origin: origin } });
      this.ws = ws;
      let challengeReceived = false;
      const timeout = setTimeout(() => {
        // Critical: drop connectingPromise here. Otherwise subsequent calls
        // keep awaiting a rejected promise and never try a fresh connect.
        if (this.connectingPromise) this.connectingPromise = null;
        try {
          ws.terminate();
        } catch {
          // ignore
        }
        reject(new Error(`gateway connect timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      ws.on("open", () => {
        // Wait for connect.challenge before sending connect.
      });

      ws.on("message", (raw) => {
        let frame: GatewayFrame;
        try {
          frame = JSON.parse(raw.toString());
        } catch (err) {
          console.warn("[openclaw-adapter] bad frame:", err);
          return;
        }
        if (frame.type === "event" && frame.event === "connect.challenge") {
          challengeReceived = true;
          this.handshake(ws).then(
            () => {
              clearTimeout(timeout);
              this.connected = true;
              this.connectingPromise = null;
              this.startHeartbeat();
              // Subscribe to session-level events so chat/agent/tool frames
              // get broadcast to this connection. Without this, the gateway
              // only sends connection-wide events (tick/health) and the SSE
              // stream sees nothing the chat panel can render. Best-effort
              // — subscribe is tiny, but if it fails we don't unwind the
              // connect since the WS is still usable for RPC.
              this.callOnce("sessions.subscribe", {}, 5_000).catch((err) => {
                console.warn(
                  "[openclaw-adapter] sessions.subscribe failed:",
                  err instanceof Error ? err.message : err,
                );
              });
              resolve();
            },
            (err) => {
              clearTimeout(timeout);
              this.connectingPromise = null;
              ws.close();
              reject(err);
            },
          );
          return;
        }
        if (!challengeReceived) {
          // some gateways send banner events before challenge — ignore
          return;
        }
        this.handleFrame(frame);
      });

      ws.on("error", (err) => {
        clearTimeout(timeout);
        this.connectingPromise = null;
        // Always settle: if this.connected is somehow already true (stale
        // state), `reject` is a no-op on an already-resolved promise — which
        // is fine and keeps the error from propagating as uncaughtException.
        reject(err);
      });

      ws.on("close", () => {
        try {
          this.connected = false;
          this.connectingPromise = null;
          // Optional chaining: old instances pinned in globalThis from
          // pre-HMR module versions don't have stopHeartbeat on their
          // prototype, and crashing here would take down the dev server.
          this.stopHeartbeat?.();
          if (this.ws === ws) this.ws = null;
          const error = new Error("gateway connection closed");
          for (const [, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(error);
          }
          this.pending.clear();
        } catch (err) {
          console.warn("[openclaw-adapter] close handler threw:", err);
        }
      });

      ws.on("pong", () => {
        try {
          if (this.pongTimer) {
            clearTimeout(this.pongTimer);
            this.pongTimer = null;
          }
        } catch (err) {
          console.warn("[openclaw-adapter] pong handler threw:", err);
        }
      });
    });

    return this.connectingPromise;
  }

  private async handshake(ws: WebSocket): Promise<void> {
    const id = randomUUID();
    // Legacy-control-ui profile: works when gateway has
    //   gateway.controlUi.dangerouslyDisableDeviceAuth = true
    // Backend-local profile is rejected with "device identity required"
    // unless we pair the portal as a device, which we'll add later.
    const params: Record<string, unknown> = {
      minProtocol: DEFAULT_PROTOCOL_VERSION,
      maxProtocol: DEFAULT_PROTOCOL_VERSION,
      client: {
        id: "openclaw-control-ui",
        version: "dev",
        platform: "web",
        mode: "webchat",
      },
      role: "operator",
      scopes: [
        "operator.admin",
        "operator.read",
        "operator.write",
        "operator.approvals",
        "operator.pairing",
      ],
      caps: ["tool-events"],
      auth: { token: this.token ?? "" },
    };
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("connect handshake timeout"));
      }, 6000);

      const onMessage = (raw: WebSocket.RawData) => {
        let frame: GatewayFrame;
        try {
          frame = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (frame.type === "res" && frame.id === id) {
          clearTimeout(timeout);
          ws.off("message", onMessage);
          if (frame.ok) resolve();
          else
            reject(
              new Error(
                frame.error?.message ?? "connect rejected by gateway",
              ),
            );
        }
      };

      ws.on("message", onMessage);
      ws.send(JSON.stringify({ type: "req", id, method: "connect", params }));
    });
  }

  private handleFrame(frame: GatewayFrame) {
    if (frame.type === "res") {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      this.pending.delete(frame.id);
      clearTimeout(pending.timer);
      if (frame.ok) pending.resolve(frame.payload);
      else
        pending.reject(
          new Error(
            `${frame.error?.code ?? "ERR"}: ${frame.error?.message ?? "unknown gateway error"}`,
          ),
        );
      return;
    }
    if (frame.type === "event") {
      for (const listener of this.listeners) {
        try {
          listener(frame.event, frame.payload);
        } catch (err) {
          console.warn("[openclaw-adapter] listener threw:", err);
        }
      }
    }
  }

  async call<T = unknown>(
    method: string,
    params: unknown = {},
    timeoutMs = 12_000,
  ): Promise<T> {
    // Retry transient WS failures (gateway restart drops the socket). Each
    // config.set on openclaw can rotate the gateway process, which routinely
    // takes 5–8s to come back up under load. Real gateway-returned errors
    // (validation, schema rejections) are NOT retried — those come through
    // callOnce's promise as rejections from a *response* frame.
    const backoffMs = [0, 1500, 4000, 8000];
    let lastErr: unknown = null;
    for (let i = 0; i < backoffMs.length; i++) {
      if (backoffMs[i] > 0) {
        await new Promise((r) => setTimeout(r, backoffMs[i]));
      }
      try {
        return await this.callOnce<T>(method, params, timeoutMs);
      } catch (err) {
        lastErr = err;
        if (!isTransientWsError(err)) throw err;
        this.invalidate();
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(String(lastErr));
  }

  private async callOnce<T>(
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<T> {
    if (this.connectingPromise) {
      try {
        await this.connectingPromise;
      } catch {
        // fall through and try a fresh connect below
      }
    }
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.CLOSING ||
        this.ws.readyState === WebSocket.CLOSED)
    ) {
      this.invalidate();
    }
    if (!this.connected || !this.ws) await this.connect();
    if (!this.ws) throw new Error("not connected");
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.invalidate();
        reject(new Error(`gateway timeout: ${method} (${timeoutMs}ms)`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (payload) => resolve(payload as T),
        reject,
        timer,
      });
      this.ws!.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  /**
   * Polls the gateway with a cheap, idempotent call until it responds or
   * the deadline passes. Use after operations that trigger a config reload
   * (`agents.create`, `config.set`) so the next caller doesn't trip into a
   * mid-restart window.
   *
   * @param maxWaitMs total budget in ms; throws if not ready by then.
   */
  async waitUntilReady(maxWaitMs = 90_000): Promise<void> {
    const start = Date.now();
    let attempt = 0;
    while (true) {
      try {
        // models.list is read-only, runs against the runtime config, and
        // doesn't touch agents/sessions. Cheapest "is the gateway up?" probe.
        // Generous per-attempt timeout: the gateway can take 15–20s to
        // answer when under load (config reloads churn through plugins),
        // and a too-tight probe just burns retry budget on healthy-but-slow.
        await this.callOnce("models.list", {}, 20_000);
        return;
      } catch (err) {
        const ws = isTransientWsError(err);
        const startup = isGatewayStartupError(err);
        if (!ws && !startup) {
          // A real error — surface it.
          throw err;
        }
        const elapsed = Date.now() - start;
        if (elapsed >= maxWaitMs) {
          throw new Error(
            `gateway didn't come back within ${maxWaitMs}ms (last error: ${
              err instanceof Error ? err.message : String(err)
            })`,
          );
        }
        if (ws) {
          // Tear down stale state so the next probe gets a fresh socket.
          this.invalidate();
        }
        // For startup errors the WS is fine; just back off and ask again.
        const backoff = Math.min(2_000, 250 * 2 ** attempt);
        attempt++;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  /** Force a reconnect on the next call. Used when a request times out. */
  private invalidate(): void {
    this.connected = false;
    this.connectingPromise = null;
    this.stopHeartbeat();
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  /**
   * Liveness probe: ws.ping() every 30s, expect pong within 30s, else
   * invalidate. The wide pong window matters because the gateway's event
   * loop blocks for tens of seconds at a time while running an LLM turn —
   * a tighter window kills the socket mid-chat and we lose every tool /
   * agent event broadcast for the rest of the run. The call() timeout is
   * the real liveness signal for active RPCs; this just covers the
   * idle-connection-dropped case.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.invalidate();
        return;
      }
      try {
        this.ws.ping();
      } catch {
        this.invalidate();
        return;
      }
      this.pongTimer = setTimeout(() => {
        this.invalidate();
      }, 30_000);
    }, 30_000);
    this.heartbeat.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  on(listener: GatewayEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.stopHeartbeat();
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.connected = false;
    this.connectingPromise = null;
  }
}

// Pinning to globalThis lets the client survive Next.js dev-mode HMR for
// edits to *other* files. But when this file itself changes, the OpenClawClient
// class definition is new; we don't want the existing instance (built from
// the old class) lingering, since its methods would be stale. The slot key
// changes with each module load so the previous instance is dropped.
const GLOBAL_KEY = Symbol.for("flatclaw.portal.gateway-client");
const PREV_KEY = Symbol.for("flatclaw.portal.gateway-client.prev");
type GlobalSlot = { [k: symbol]: OpenClawClient | undefined };

// Tear down any prior instance from a previous module load. Tricky:
//   - Calling close handlers from stale instances would crash (their methods
//     reference symbols that may no longer exist on the prototype). The new
//     class fixes this with optional chaining + try/catch in handlers.
//   - We still need to absorb any pending 'error' events on the old socket;
//     a `ws` without an 'error' listener throws uncaught when the underlying
//     TCP layer fails, which manifests as ECONNREFUSED at <unknown>.
{
  const slot = globalThis as unknown as GlobalSlot;
  const prev = slot[GLOBAL_KEY];
  if (prev) {
    try {
      const prevWs = (prev as unknown as { ws?: WebSocket }).ws;
      if (prevWs) {
        // Absorb any further error events so they don't bubble up as
        // uncaughtException after we let go of this instance.
        prevWs.on("error", () => {
          /* noop: stale socket, errors are expected during teardown */
        });
        try {
          prevWs.terminate();
        } catch {
          // ignore — already dead
        }
      }
    } catch {
      // ignore — best-effort
    }
    slot[GLOBAL_KEY] = undefined;
    slot[PREV_KEY] = prev; // keep a weak reference for diagnostics
  }
}

export function getGatewayClient(): OpenClawClient {
  const slot = globalThis as unknown as GlobalSlot;
  if (!slot[GLOBAL_KEY]) {
    slot[GLOBAL_KEY] = new OpenClawClient();
  }
  return slot[GLOBAL_KEY] as OpenClawClient;
}

/** Reset the client. Useful from a debug endpoint when a connection wedges. */
export function resetGatewayClient(): void {
  const slot = globalThis as unknown as GlobalSlot;
  const existing = slot[GLOBAL_KEY];
  if (existing) {
    existing.close();
    slot[GLOBAL_KEY] = undefined;
  }
}
