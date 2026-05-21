/**
 * Maps a portal user to an OpenClaw agent. Defines per-model defaults:
 *   - Gemma 4 31B (prod, H100): default thinkingLevel "high"
 *   - Gemma 4 E4B (dev, L4):    default thinkingLevel "medium" — same chat
 *                                template + tool-call grammar as 31B; smaller
 *                                model so we ask less of its reasoning budget
 */

import { homedir } from "node:os";
import { readFileSync } from "node:fs";

export interface RegisteredModel {
  providerId: string;
  id: string;
  name: string;
}

interface OpenclawProvidersConfig {
  models?: {
    providers?: Record<string, { models?: { id: string; name?: string }[] }>;
  };
  agents?: { defaults?: { model?: string } };
}

export function readRegisteredModels(): RegisteredModel[] {
  try {
    const path =
      process.env.PORTAL_OPENCLAW_CONFIG ?? `${homedir()}/.openclaw/openclaw.json`;
    const cfg = JSON.parse(readFileSync(path, "utf8")) as OpenclawProvidersConfig;
    const out: RegisteredModel[] = [];
    for (const [providerId, p] of Object.entries(cfg.models?.providers ?? {})) {
      for (const m of p.models ?? []) {
        out.push({ providerId, id: m.id, name: m.name ?? m.id });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function readDefaultModel(): string | null {
  try {
    const path =
      process.env.PORTAL_OPENCLAW_CONFIG ?? `${homedir()}/.openclaw/openclaw.json`;
    const cfg = JSON.parse(readFileSync(path, "utf8")) as OpenclawProvidersConfig;
    return cfg.agents?.defaults?.model ?? null;
  } catch {
    return null;
  }
}

export function slugifyAgentId(email: string): string {
  return email
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function buildSoul(args: {
  identityName: string;
  email: string;
  agentId: string;
  modelId: string;
}): string {
  // Reasoning depth is governed at the gateway via
  // agents.defaults.thinkingDefault — we don't bake any model-specific
  // directives into SOUL.md so the same prompt works across model swaps.
  void args.modelId;

  return `# I am ${args.identityName}

You are ${args.identityName}'s personal AI agent operating inside FlatClaw.

- Your identity: **${args.identityName}** (${args.email})
- Your agent id: \`${args.agentId}\`
- Your workspace: \`~/.openclaw/workspace-${args.agentId}/\`
- Files in your workspace belong to ${args.identityName}.
- When using Gmail, you act on ${args.identityName}'s behalf with their stored OAuth token.

Be respectful of ${args.identityName}'s privacy. Cross-user actions (emailing other agents) are explicit and audited.

## Conversational defaults

When ${args.identityName} addresses you directly — greetings, check-ins,
small talk, status questions ("are you there?", "hi", "ping") — **always
respond with a real reply**. Never use the \`NO_REPLY\` sentinel for direct
human-to-agent conversation. \`NO_REPLY\` is only for purely-automated
heartbeat events that ${args.identityName} did not send. If a real human
typed it, answer it.
`;
}

export function defaultThinkingLevel(modelId: string): "low" | "medium" | "high" {
  // Both dev and prod are Gemma 4 now (E4B for dev on L4, 31B for prod on
  // H100). The 31B has the budget for deep reasoning; the E4B doesn't, so
  // we tier by size rather than by family.
  const m = modelId.toLowerCase();
  if (m.includes("31b") || m.includes("31-b")) return "high";
  if (m.includes("gemma")) return "medium";
  return "low";
}
