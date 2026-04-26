import type { Page } from "@playwright/test";
import type { AgentStoreSeed } from "@/features/agents/state/store";

type RuntimeRouteFixture = {
  summary?: {
    status: string;
    reason?: string | null;
    error?: string | null;
  };
  fleetResult?: {
    seeds: AgentStoreSeed[];
    sessionCreatedAgentIds: string[];
    sessionSettingsSyncedAgentIds: string[];
    summaryPatches: Array<{ agentId: string; patch: Record<string, unknown> }>;
    suggestedSelectedAgentId: string | null;
    configSnapshot: Record<string, unknown> | null;
  };
};

const DEFAULT_SUMMARY: RuntimeRouteFixture["summary"] = {
  status: "connected",
  reason: null,
  error: null,
};

const DEFAULT_FLEET_RESULT: RuntimeRouteFixture["fleetResult"] = {
  seeds: [],
  sessionCreatedAgentIds: [],
  sessionSettingsSyncedAgentIds: [],
  summaryPatches: [],
  suggestedSelectedAgentId: null,
  configSnapshot: null,
};

export const stubRuntimeRoutes = async (page: Page, fixture: RuntimeRouteFixture = {}) => {
  await page.route("**/api/runtime/fleet", async (route, request) => {
    if (request.method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        result: fixture.fleetResult ?? DEFAULT_FLEET_RESULT,
      }),
    });
  });

  await page.route("**/api/runtime/summary", async (route, request) => {
    if (request.method() !== "GET") {
      await route.fallback();
      return;
    }
    const asOf = new Date().toISOString();
    const summary = fixture.summary ?? DEFAULT_SUMMARY;
    await route.fulfill({
      status: summary.error ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        summary: {
          status: summary.status,
          reason: summary.reason ?? null,
          asOf,
          outboxHead: 0,
        },
        ...(summary.error ? { error: summary.error } : {}),
        freshness: {
          source: summary.error ? "projection" : "gateway",
          stale: Boolean(summary.error),
          asOf,
        },
      }),
    });
  });

  await page.route("**/api/runtime/agents/*/history*", async (route, request) => {
    if (request.method() !== "GET") {
      await route.fallback();
      return;
    }
    const asOf = new Date().toISOString();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        messages: [],
        hasMore: false,
        semanticTurnsIncluded: 0,
        windowTruncated: false,
        gatewayLimit: 200,
        gatewayCapped: false,
        freshness: {
          source: "gateway",
          stale: false,
          asOf,
        },
      }),
    });
  });

  await page.route("**/api/runtime/stream", async (route, request) => {
    if (request.method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: ": heartbeat\n\n",
      headers: {
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  });
};
