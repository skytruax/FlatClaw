/**
 * JiraApiClient — single REST surface for the Jira MCP.
 *
 * Talks directly to Atlassian Cloud Jira REST API v3 at
 * `<workspace_url>/rest/api/3/...` using HTTP Basic auth (`<email>:<api_token>`).
 *
 * Credentials come from the FlatClaw portal's cap-token bridge at
 * `${PORTAL_BASE_URL}/api/internal/jira-token`. Atlassian API tokens are
 * long-lived; the MCP caches the bridge response on a short TTL.
 */

import { ComposedMutation, type ComposedRest } from "./approval.js";

const TOKEN_TTL_MS = 5 * 60_000;

interface BridgeResponse {
  ok?: boolean;
  email?: string;
  workspace_url?: string;
  api_token?: string;
  error?: string;
}

interface CachedCreds {
  email: string;
  workspaceUrl: string;
  basic: string; // pre-baked Basic <base64(email:token)>
  refreshAt: number;
}

export class JiraApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly response?: unknown,
  ) {
    super(message);
    this.name = "JiraApiError";
  }
}

export interface FetchOpts {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | string[] | undefined>;
  json?: unknown;
  /** Raw body — caller sets Content-Type via `headers`. Used for multipart attachments. */
  body?: BodyInit;
  headers?: Record<string, string>;
  /** Return the response body as a Buffer (e.g. for attachment downloads). */
  binary?: boolean;
}

export class JiraApiClient {
  private cache: CachedCreds | null = null;
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

  /** Email of the connected Atlassian account, populated after first creds fetch. */
  identityHint(): string | null {
    return this.cache?.email ?? null;
  }
  workspaceHint(): string | null {
    return this.cache?.workspaceUrl ?? null;
  }

  private async getCreds(): Promise<CachedCreds> {
    const now = Date.now();
    if (this.cache && this.cache.refreshAt > now) return this.cache;
    const url =
      this.portalBase.replace(/\/+$/, "") + "/api/internal/jira-token";
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.capabilityToken}` },
    });
    const body = (await res.json().catch(() => ({}))) as BridgeResponse;
    if (
      !res.ok ||
      !body.ok ||
      !body.email ||
      !body.workspace_url ||
      !body.api_token
    ) {
      throw new JiraApiError(
        `jira-token bridge ${res.status}: ${body.error ?? "unknown"}`,
        res.status,
        body,
      );
    }
    const basic = Buffer.from(
      `${body.email}:${body.api_token}`,
      "utf8",
    ).toString("base64");
    this.cache = {
      email: body.email,
      workspaceUrl: body.workspace_url.replace(/\/+$/, ""),
      basic: `Basic ${basic}`,
      refreshAt: now + TOKEN_TTL_MS,
    };
    return this.cache;
  }

  /**
   * Make a request to the Jira REST API. `path` should start with `/rest/api/3/...`.
   */
  async request<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T> {
    const creds = await this.getCreds();
    const url = new URL(creds.workspaceUrl + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) {
          for (const item of v) url.searchParams.append(k, item);
        } else {
          url.searchParams.set(k, String(v));
        }
      }
    }
    const method = opts.method ?? "GET";
    if (this.composeArmed && method !== "GET") {
      this.composeArmed = false;
      if (opts.json === undefined && opts.body !== undefined) {
        throw new JiraApiError(
          `${method} ${path} carries a non-JSON body and cannot be composed for human approval`,
        );
      }
      // Capture on the client (survives handlers that swallow the throw),
      // then abort the handler at the mutation point. No credentials leave
      // this process — the portal replays with vault creds on approval.
      this.composed = { method, url: url.toString(), json: opts.json };
      throw new ComposedMutation(this.composed);
    }
    const headers = new Headers(opts.headers ?? {});
    headers.set("Authorization", creds.basic);
    if (!opts.binary) headers.set("Accept", "application/json");
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(opts.json);
    } else if (opts.body !== undefined) {
      body = opts.body;
    }
    const res = await fetch(url.toString(), {
      method,
      headers,
      body,
      // Attachment downloads via /rest/api/3/attachment/content/<id> 302
      // to a signed S3-style URL — fetch must follow.
      redirect: "follow",
    });
    if (!res.ok) {
      const errText = await res.text();
      let parsed: unknown = errText;
      if (errText) {
        try {
          parsed = JSON.parse(errText);
        } catch {
          /* keep raw */
        }
      }
      throw new JiraApiError(
        `${res.status} ${res.statusText} ${path}: ${typeof parsed === "string" ? parsed.slice(0, 400) : JSON.stringify(parsed).slice(0, 400)}`,
        res.status,
        parsed,
      );
    }
    if (opts.binary) {
      const buf = Buffer.from(await res.arrayBuffer());
      return buf as unknown as T;
    }
    const text = await res.text();
    if (!text) return undefined as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }
}
