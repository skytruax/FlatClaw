/**
 * Where the gateways send model requests: the stored values.
 *
 * Until 2026-10 this was the Northflank secret PROD_INFERENCE_URL (plus
 * PROD_MODEL_ID), reconciled into the one gateway's config by
 * infra/kirk/start-control.sh at every boot: changing it meant editing the
 * service environment and redeploying. Now the portal holds it, an admin
 * edits it on the Settings page, and lib/settings/push-inference.ts writes
 * it into every gateway's config. The environment variables remain the
 * default while nothing has been saved, so a first boot still comes up wired.
 */
import { getSetting, setSetting } from "./store";
import {
  DEFAULT_CONTEXT_WINDOW, DEFAULT_MODEL_ID, modelRefFor, normalizeInferenceUrl, type InferenceSettings,
} from "./inference-config";

export * from "./inference-config";

const KEY_URL = "inference.url";
const KEY_MODEL = "inference.modelId";
const KEY_CONTEXT = "inference.contextWindow";

export function readInferenceSettings(): InferenceSettings {
  const savedUrl = getSetting(KEY_URL);
  const savedModel = getSetting(KEY_MODEL);
  const savedContext = getSetting(KEY_CONTEXT);
  if (savedUrl !== null || savedModel !== null) {
    const ctx = Number(savedContext);
    return {
      url: normalizeInferenceUrl(savedUrl),
      modelId: (savedModel ?? "").trim() || process.env.PROD_MODEL_ID?.trim() || DEFAULT_MODEL_ID,
      contextWindow: Number.isInteger(ctx) && ctx > 0 ? ctx : DEFAULT_CONTEXT_WINDOW,
      source: "portal",
    };
  }
  const envUrl = normalizeInferenceUrl(process.env.PROD_INFERENCE_URL);
  return {
    url: envUrl,
    modelId: process.env.PROD_MODEL_ID?.trim() || DEFAULT_MODEL_ID,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    source: envUrl ? "env" : "none",
  };
}

/** Persist the settings. Does not touch any gateway; see push-inference.ts. */
export function saveInferenceSettings(input: { url: string | null; modelId?: string; contextWindow?: number }): InferenceSettings {
  const url = normalizeInferenceUrl(input.url);
  const modelId = (input.modelId ?? "").trim() || DEFAULT_MODEL_ID;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(modelId)) {
    throw new Error(`model id has characters a provider would not accept: ${JSON.stringify(modelId)}`);
  }
  const contextWindow =
    Number.isInteger(input.contextWindow) && (input.contextWindow as number) > 0 ? (input.contextWindow as number) : DEFAULT_CONTEXT_WINDOW;
  setSetting(KEY_URL, url ?? "");
  setSetting(KEY_MODEL, modelId);
  setSetting(KEY_CONTEXT, String(contextWindow));
  return readInferenceSettings();
}

/** Forget the saved values; the environment variables apply again. */
export function clearInferenceSettings(): void {
  setSetting(KEY_URL, null);
  setSetting(KEY_MODEL, null);
  setSetting(KEY_CONTEXT, null);
}

export function inferenceModelRef(s: InferenceSettings = readInferenceSettings()): string | null {
  return modelRefFor(s);
}
