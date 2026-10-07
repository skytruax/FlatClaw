/**
 * The config a new per-user gateway starts with. Pure: the supervisor writes
 * the result to the state directory before the gateway's first start, so the
 * gateway never serves a moment on OpenClaw's own defaults.
 *
 * It mirrors what infra/kirk/start-control.sh seeds for the shared gateway
 * (local mode, loopback, token auth, the inference provider, web search) plus
 * the tenant baseline, and it turns the heartbeat off: a per-user gateway has
 * no ambient agent that should wake the model every half hour.
 */
import type { ConfigBlob } from "@/lib/openclaw/agent-roster";
import { applyTenantBaseline } from "@/lib/openclaw/tenant-baseline";
import { applyInferenceSettings, type InferenceSettings } from "@/lib/settings/inference-config";

export interface UserGatewayTemplateInput {
  port: number;
  token: string;
  /** Where model requests go; omit for a gateway with no model server yet. */
  inference?: InferenceSettings | null;
  /** Whether the DuckDuckGo search plugin will be installed (the control image bundles it). */
  webSearch?: boolean;
}

export function buildUserGatewayConfig(input: UserGatewayTemplateInput): ConfigBlob & Record<string, unknown> {
  const cfg: ConfigBlob & Record<string, unknown> = {
    gateway: {
      mode: "local",
      auth: { mode: "token", token: input.token },
      port: input.port,
      bind: "loopback",
      tailscale: { mode: "off" },
    },
    models: { providers: {} },
    agents: { defaults: { heartbeat: { every: "0m" } } },
  };
  if (input.webSearch !== false) {
    cfg.plugins = { entries: { duckduckgo: { enabled: true } } };
    cfg.tools = { web: { search: { provider: "duckduckgo" } } };
  }
  if (input.inference) applyInferenceSettings(cfg, input.inference);
  applyTenantBaseline(cfg);
  return cfg;
}
