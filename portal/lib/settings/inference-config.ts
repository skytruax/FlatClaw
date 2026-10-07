/**
 * The inference wiring as a pure value and the function that writes it into
 * a gateway config. No database here: the gateway config template and the
 * unit tests use this; lib/settings/inference.ts adds the stored values.
 *
 * The provider id stays `openai` (an OpenAI-compatible server) so that
 * existing agents, which inherit `agents.defaults.model`, keep working.
 */
import type { ConfigBlob } from "@/lib/openclaw/agent-roster";

export const INFERENCE_PROVIDER_ID = "openai";
export const DEFAULT_MODEL_ID = "gemma-4-31b-it";
export const DEFAULT_CONTEXT_WINDOW = 262144;

export interface InferenceSettings {
  /** OpenAI-compatible base URL, e.g. http://inference:8000/v1. Null = no model server. */
  url: string | null;
  modelId: string;
  contextWindow: number;
  /** Where the values came from. */
  source: "portal" | "env" | "none";
}

/** Trim, validate (http/https), strip trailing slashes. Empty → null. Throws on garbage. */
export function normalizeInferenceUrl(s: string | null | undefined): string | null {
  const v = (s ?? "").trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error(`inference URL is not a URL: ${JSON.stringify(v)}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("inference URL must be http or https");
  return v.replace(/\/+$/, "");
}

export function modelRefFor(s: InferenceSettings): string | null {
  return s.url ? `${INFERENCE_PROVIDER_ID}/${s.modelId}` : null;
}

/** The provider entry a gateway needs for these settings (same shape start-control.sh seeds). */
export function inferenceProviderEntry(s: InferenceSettings): Record<string, unknown> | null {
  if (!s.url) return null;
  return {
    baseUrl: s.url,
    apiKey: "no-auth-needed",
    api: "openai-completions",
    timeoutSeconds: 600,
    models: [
      {
        id: s.modelId,
        name: "Gemma 4 31B (FlatClaw)",
        api: "openai-completions",
        contextWindow: s.contextWindow,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
        compat: { supportsTools: true, supportsReasoningEffort: true },
      },
    ],
  };
}

/**
 * Whether a provider entry already says what we want. A config read from a
 * running gateway has its `apiKey` replaced by a redaction sentinel (the
 * gateway restores the stored value on write), so that field is compared
 * only when the entry carries a real value. Without this every save looked
 * like a change and rewrote, and so reloaded, every gateway.
 */
const REDACTED = "__OPENCLAW_REDACTED__";
function sameProvider(current: unknown, desired: Record<string, unknown>): boolean {
  if (!current || typeof current !== "object") return false;
  const a = { ...(current as Record<string, unknown>) };
  const b = { ...desired };
  if (a.apiKey === REDACTED) {
    delete a.apiKey;
    delete b.apiKey;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Write the settings into a gateway config document. With no URL the
 * provider is removed and the default model unset (turns then fail with a
 * clear "no model" error instead of reaching a dead endpoint). Returns the
 * keys changed.
 */
export function applyInferenceSettings(cfg: ConfigBlob, s: InferenceSettings): string[] {
  const changed: string[] = [];
  const blob = cfg as ConfigBlob & { models?: { providers?: Record<string, unknown> } };
  blob.models = blob.models ?? {};
  blob.models.providers = blob.models.providers ?? {};
  blob.agents = blob.agents ?? {};
  blob.agents.defaults = blob.agents.defaults ?? {};
  const desired = inferenceProviderEntry(s);
  const current = blob.models.providers[INFERENCE_PROVIDER_ID];
  if (desired) {
    if (!sameProvider(current, desired)) {
      blob.models.providers[INFERENCE_PROVIDER_ID] = desired;
      changed.push(`models.providers.${INFERENCE_PROVIDER_ID}`);
    }
    const ref = modelRefFor(s)!;
    if (blob.agents.defaults.model !== ref) {
      blob.agents.defaults.model = ref;
      changed.push("agents.defaults.model");
    }
  } else {
    if (current !== undefined) {
      delete blob.models.providers[INFERENCE_PROVIDER_ID];
      changed.push(`models.providers.${INFERENCE_PROVIDER_ID}`);
    }
    if (typeof blob.agents.defaults.model === "string" && blob.agents.defaults.model.startsWith(`${INFERENCE_PROVIDER_ID}/`)) {
      delete blob.agents.defaults.model;
      changed.push("agents.defaults.model");
    }
  }
  return changed;
}
