import { findAgentEntry, type ConfigBlob } from "./agent-roster";

/**
 * Where a model's context window lives in the gateway config.
 *
 * Through openclaw 2026.7 the tenant-wide budget was
 * `agents.defaults.contextTokens` (with an optional per-agent override). Both
 * were removed in 2026.8 — "cannot be represented per model" — and the window
 * is now a property of the model entry itself:
 *
 *   models.providers.<provider>.models[] = { id, contextWindow, contextTokens? }
 *
 * `contextTokens` is the effective budget when it is set below the model's
 * native `contextWindow`; otherwise the window is the budget.
 */

interface ProviderModel {
  id?: string;
  contextWindow?: number;
  contextTokens?: number;
}

type ModelRefValue = string | { primary?: string } | undefined;

function primaryModelRef(value: ModelRefValue): string | null {
  if (typeof value === "string") return value || null;
  if (value && typeof value.primary === "string") return value.primary || null;
  return null;
}

/** Context window (tokens) of a `<provider>/<model>` ref, or null when the config does not say. */
export function modelContextTokens(cfg: ConfigBlob, modelRef: string | null): number | null {
  if (!modelRef) return null;
  const slash = modelRef.indexOf("/");
  if (slash <= 0) return null;
  const providers = (cfg.models as { providers?: Record<string, { models?: ProviderModel[] }> } | undefined)
    ?.providers;
  const model = providers?.[modelRef.slice(0, slash)]?.models?.find(
    (m) => m.id === modelRef.slice(slash + 1),
  );
  const tokens = model?.contextTokens ?? model?.contextWindow;
  return typeof tokens === "number" ? tokens : null;
}

/**
 * Context window an agent's sessions run with: its own model if the roster
 * entry pins one, else the tenant default model.
 */
export function agentContextTokens(cfg: ConfigBlob, agentId: string | null | undefined): number | null {
  const own = agentId ? primaryModelRef(findAgentEntry(cfg, agentId)?.model as ModelRefValue) : null;
  const tenantDefault = primaryModelRef(cfg.agents?.defaults?.model as ModelRefValue);
  return modelContextTokens(cfg, own) ?? modelContextTokens(cfg, tenantDefault);
}
