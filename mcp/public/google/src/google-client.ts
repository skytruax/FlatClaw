/**
 * GoogleApiClient — single REST surface for the Google MCP.
 *
 * Each call goes straight to the relevant Google REST API
 * (gmail.googleapis.com, www.googleapis.com/drive/v3, etc) using a
 * fresh access token from the FlatClaw portal's cap-token bridge at
 * `${PORTAL_BASE_URL}/api/internal/oauth/google/token`.
 *
 * No CLI. No `gog` binary. The deployed install does not need anything
 * Google-related on the host beyond Node + this MCP.
 *
 * Token freshness: 50s in-memory cache, then re-fetch from the bridge
 * (which itself refreshes against Google's token endpoint when within
 * 60s of expiry — see portal/lib/credentials/oauth-token-bridge.ts).
 */

import { ComposedMutation, type ComposedRest } from "./approval.js";

const TOKEN_TTL_MS = 50_000;

interface BridgeResponse {
  ok?: boolean;
  access_token?: string;
  expires_at?: string | null;
  identity?: string | null;
  scope?: string | null;
  error?: string;
}

interface CachedToken {
  accessToken: string;
  identity: string | null;
  refreshAt: number;
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly response?: unknown,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export interface FetchOpts {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /**
   * Query params. Array values become repeated params (e.g. Google's
   * `metadataHeaders` wants `?metadataHeaders=Subject&metadataHeaders=From`,
   * not a comma-separated string).
   */
  query?: Record<
    string,
    string | number | boolean | string[] | undefined
  >;
  /** JSON body — auto-stringified, content-type set to application/json. */
  json?: unknown;
  /** Raw body (Buffer or string) — caller sets content-type via `headers`. */
  body?: BodyInit;
  /** Additional / overriding headers. */
  headers?: Record<string, string>;
  /** Set if the response body is binary (returns Buffer instead of JSON-parsing). */
  binary?: boolean;
}

export class GoogleApiClient {
  private cache: CachedToken | null = null;
  /** Compose mode: when armed, the next mutating request is captured instead of sent. */
  private composeArmed = false;
  private composed: ComposedRest | null = null;

  constructor(
    private readonly portalBase: string,
    private readonly capabilityToken: string,
  ) {}

  /** Arm compose mode for one approval-gated tool invocation. */
  armCompose(): void {
    this.composeArmed = true;
    this.composed = null;
  }
  disarmCompose(): void {
    this.composeArmed = false;
  }
  /** Return-and-clear the captured mutation, if the armed handler attempted one. */
  takeComposed(): ComposedRest | null {
    const c = this.composed;
    this.composed = null;
    return c;
  }

  /** Email of the connected Google account, populated after the first token fetch. */
  identityHint(): string | null {
    return this.cache?.identity ?? null;
  }

  private async getToken(): Promise<CachedToken> {
    const now = Date.now();
    if (this.cache && this.cache.refreshAt > now) return this.cache;
    const url =
      this.portalBase.replace(/\/+$/, "") + "/api/internal/oauth/google/token";
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.capabilityToken}` },
    });
    const body = (await res.json().catch(() => ({}))) as BridgeResponse;
    if (!res.ok || !body.ok || !body.access_token) {
      throw new GoogleApiError(
        `google-token bridge ${res.status}: ${body.error ?? "unknown"}`,
        res.status,
        body,
      );
    }
    this.cache = {
      accessToken: body.access_token,
      identity: body.identity ?? null,
      refreshAt: now + TOKEN_TTL_MS,
    };
    return this.cache;
  }

  /** Make an authenticated request to a Google API. URL must be absolute. */
  async request<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
    const tok = await this.getToken();
    const u = new URL(url);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) {
          for (const item of v) u.searchParams.append(k, item);
        } else {
          u.searchParams.set(k, String(v));
        }
      }
    }
    const method = opts.method ?? "GET";
    if (this.composeArmed && method !== "GET") {
      this.composeArmed = false;
      if (opts.json === undefined && opts.body !== undefined) {
        throw new GoogleApiError(
          `${method} ${u.pathname} carries a non-JSON body and cannot be composed for human approval`,
        );
      }
      // Capture on the client (survives handleToolCall swallowing the throw),
      // then abort the handler at the mutation point. No credentials leave
      // this process — the portal replays with a fresh token on approval.
      this.composed = { method, url: u.toString(), json: opts.json };
      throw new ComposedMutation(this.composed);
    }
    const headers = new Headers(opts.headers ?? {});
    headers.set("Authorization", `Bearer ${tok.accessToken}`);
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(opts.json);
    } else if (opts.body !== undefined) {
      body = opts.body;
    }
    const res = await fetch(u.toString(), {
      method,
      headers,
      body,
    });
    const text = opts.binary ? null : await res.text();
    if (!res.ok) {
      let parsed: unknown = text;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          /* keep raw */
        }
      }
      throw new GoogleApiError(
        `${res.status} ${res.statusText} ${u.pathname}: ${typeof parsed === "string" ? parsed.slice(0, 400) : JSON.stringify(parsed).slice(0, 400)}`,
        res.status,
        parsed,
      );
    }
    if (opts.binary) {
      const buf = Buffer.from(await res.arrayBuffer());
      return buf as unknown as T;
    }
    if (!text) return undefined as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }
}
