import type { ConfigBlob } from "./agent-roster";

/**
 * The gateway settings FlatClaw fixes on every tenant, independent of whatever
 * the installed OpenClaw defaults to.
 *
 * Why this exists: OpenClaw is a single-operator product whose defaults keep
 * getting more permissive between releases. FlatClaw runs many users' agents
 * on one gateway, so a default that is harmless for one person can cross a
 * tenant boundary here. Between 2026.7.1 and 2026.9.8 upstream flipped, among
 * others:
 *
 *   - `tools.sessions.visibility`  tree → all   (session tools reach every
 *     agent's sessions)
 *   - `tools.agentToAgent`         off  → on    (agents can message each other)
 *   - `tools.swarm`                —    → on    (up to 32 concurrent sub-agents)
 *   - `tools.toolSearch`           off  → on    (MCP tools reached through
 *     tool_search / tool_call; supported since 2026-10-06, still defaulted
 *     off until tried against the real model)
 *   - the `coding` tool profile grew from 23 offered tools to 40, including
 *     `gateway`, `plugins`, `secrets` and `terminal`
 *   - memory "dreaming" and the Skill Workshop's autonomous mode both on,
 *     each adding scheduled model calls per agent
 *   - memory search embedding each agent's files and transcripts after every
 *     turn, through whatever provider is registered as `openai`
 *   - an operator terminal (a host shell over RPC) on by default, an `/update`
 *     chat command, and a model catalog fetched from openclaw's servers
 *
 * `applyTenantBaseline` writes the values below into the config document. It
 * is pure and idempotent; `ensureGlobalConfig` (skills.ts) persists it, and
 * `scripts/gateway-contract-probe.ts` verifies the result against a live
 * gateway.
 *
 * Every built-in tool is decided here, by name, in one of three lists:
 * always offered (`EXPECTED_BUILTIN_TOOLS`), allowed when the gateway offers
 * it (`OPTIONAL_BUILTIN_TOOLS`), or never offered (`DENIED_BUILTIN_TOOLS`).
 * The decision does not lean on `tools.profile`: which tools a profile offers
 * also depends on what else is configured (a registered `openai` provider
 * alone switches on the image tools), and tenants have run both the `coding`
 * and the `full` profile. The probe fails when the gateway's tool catalog
 * holds a name that is in none of the three lists, so an OpenClaw upgrade
 * that adds a tool stops there until someone decides whether agents get it.
 */

/**
 * Built-in tools no FlatClaw agent is offered. Everything here either reaches
 * the shared gateway's control plane, reaches beyond the agent's own session
 * tree, or needs a client surface the portal does not have.
 */
export const DENIED_BUILTIN_TOOLS: readonly string[] = [
  // Control plane of the shared gateway.
  "gateway", //   read/patch gateway config, restart, update
  "plugins", //   install / enable plugins
  "secrets", //   the gateway secret store
  "openclaw", //  setup-and-repair helper
  // Host and device reach.
  "terminal", //  persistent terminals (exec/process already cover shell use)
  "computer",
  "screen",
  "mobile_ui",
  "nodes",
  "node_inference",
  // Reach beyond the agent's own session tree.
  "conversations_list",
  "conversations_send",
  "conversations_turn",
  "sessions", //        change another session's settings
  "sessions_search", // search across sessions
  "github_identity_status",
  "github_publish",
  // Need a Control UI surface the portal does not render. `ask_user` in
  // particular parks the run until a question card is answered.
  "ask_user",
  "dashboard",
  "theme",
  "presence",
  "portal", //  OpenClaw's own "portal" feature — unrelated to this app
  // Paired-device file transfer and display. A tenant has no paired nodes.
  "canvas",
  "dir_fetch",
  "dir_list",
  "file_fetch",
  "file_write",
  // One browser profile on the gateway host would be shared by every user.
  "browser",
  // Reach beyond the agent's own session tree (continued).
  "agents_list", // every agent on the shared gateway
  "message", //     channel sends; a tenant has no channels, the portal is the only surface
  // Need a Control UI surface the portal does not render (continued).
  "show_widget",
  "suggest_task",
  "dismiss_task",
  // Hosted services: the request would leave the tenant, or go to the
  // self-hosted endpoint under a model name it does not serve.
  "code_execution", // remote sandbox
  "x_search",
  "image_generate",
  "music_generate",
  "video_generate",
  "tts",
  "talk_voice",
  // New and not yet reviewed for FlatClaw.
  "intent", //            standing memory intents
  "decision_evaluate", // a separate "decision model"
  "pdf", //               native PDF reading; agents use exec + poppler today
  "transcripts", //       meeting transcript captures
].sort();

/**
 * The built-in tools every agent is offered on the pinned OpenClaw with the
 * baseline applied (MCP tools come on top, per user). This is the 2026.7.1
 * `coding` roster carried forward: `cron` is now `automations`, `update_plan`
 * is now `progress_card`, and `ls` is new.
 */
export const EXPECTED_BUILTIN_TOOLS: readonly string[] = [
  "apply_patch",
  "automations",
  "create_goal",
  "edit",
  "exec",
  "get_goal",
  "ls",
  "memory_get",
  "memory_search",
  "process",
  "progress_card",
  "read",
  "session_status",
  "sessions_history",
  "sessions_list",
  "sessions_send",
  "sessions_spawn",
  "sessions_yield",
  "skill_workshop",
  "subagents",
  "update_goal",
  "web_fetch",
  "web_search",
  "write",
].sort();

/**
 * Allowed, but only present when the gateway has a reason to offer them.
 */
export const OPTIONAL_BUILTIN_TOOLS: readonly string[] = [
  // Offered only inside the gateway's own heartbeat runs.
  "heartbeat_respond",
  // Image understanding (2026.7.1 called it `image`). Offered when a provider
  // that could serve it is registered; it works once the tenant's model is
  // registered with image input.
  "view_image",
].sort();

/** Where a built-in tool stands, or "undecided" when it is in none of the lists. */
export function builtinToolDecision(
  tool: string,
): "expected" | "optional" | "denied" | "undecided" {
  if (EXPECTED_BUILTIN_TOOLS.includes(tool)) return "expected";
  if (OPTIONAL_BUILTIN_TOOLS.includes(tool)) return "optional";
  if (DENIED_BUILTIN_TOOLS.includes(tool)) return "denied";
  return "undecided";
}

/**
 * The plugins a FlatClaw tenant needs beyond OpenClaw's core: memory, the
 * keyless web search provider (installed separately since 2026.8), and the two
 * extractors `web_fetch` loads on demand. The model provider's own plugin is
 * activated by the provider entry and needs no listing.
 */
export const TENANT_PLUGINS: readonly string[] = [
  "document-extract",
  "duckduckgo",
  "memory-core",
  "web-readability",
];

/**
 * AGENTS.md now carries what used to be split across AGENTS.md and TOOLS.md
 * (OpenClaw stopped injecting TOOLS.md in 2026.8), so it gets the combined
 * allowance of the two 20k-character files it replaces.
 */
export const AGENTS_MD_MAX_CHARS = 40_000;

type Json = Record<string, unknown>;

function child(parent: Json, key: string): Json {
  const existing = parent[key];
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as Json;
  }
  const created: Json = {};
  parent[key] = created;
  return created;
}

/** Set a value only when the operator has not chosen one. */
function defaultTo(parent: Json, key: string, value: unknown): void {
  if (parent[key] === undefined) parent[key] = value;
}

/**
 * Bring a config document to the FlatClaw baseline, in place. Isolation
 * settings are enforced on every call; capacity knobs are only defaulted, so
 * an operator who tuned one keeps their value.
 */
export function applyTenantBaseline(cfg: ConfigBlob): void {
  const root = cfg as Json;

  // --- Enforced: tenant isolation and the tool contract ---------------------
  const tools = child(root, "tools");
  tools.swarm = false;
  child(tools, "sessions").visibility = "tree";
  child(tools, "agentToAgent").enabled = false;
  const deny = new Set<string>(
    Array.isArray(tools.deny)
      ? (tools.deny as unknown[]).filter((d): d is string => typeof d === "string")
      : [],
  );
  for (const tool of DENIED_BUILTIN_TOOLS) deny.add(tool);
  tools.deny = [...deny].sort();

  // --- Enforced: no gateway control from a chat box or a shared connection ---
  // Chat slash commands run with owner rights, and every portal user's message
  // arrives on the portal's admin connection (see chat-commands.ts, which
  // filters the commands that have no switch). `restart` also gates `/update`.
  const commands = child(root, "commands");
  for (const gate of ["restart", "bash", "config", "mcp", "plugins", "debug"]) {
    commands[gate] = false;
  }
  // `/elevated` — host exec from a sandboxed session. There is no sandbox.
  child(tools, "elevated").enabled = false;
  // A shell on the gateway host for any admin-scope client. On by default
  // since 2026.8; the portal never uses it.
  child(child(root, "gateway"), "terminal").enabled = false;
  // The browser: one profile on the gateway host would be shared by every
  // user. Off at both switches (the feature flag and its plugin). Changing
  // `browser` restarts a running gateway, one more reason this is written
  // before the gateway starts.
  child(root, "browser").enabled = false;
  child(child(child(root, "plugins"), "entries"), "browser").enabled = false;

  // --- Enforced: the gateway does not phone out or change itself -------------
  // The version is pinned (version-pin.ts): no update check at start (npm and
  // openclaw's telemetry host), no unattended update, and no model catalog
  // fetched from openclaw's servers.
  const update = child(root, "update");
  update.checkOnStart = false;
  child(update, "auto").enabled = false;
  child(child(root, "models"), "catalogRefresh").enabled = false;

  // --- Enforced: no background model work the tenant did not ask for --------
  const workshop = child(child(root, "skills"), "workshop");
  child(workshop, "autonomous").mode = "off";
  workshop.approvalPolicy = "pending";
  const memoryCore = child(child(child(root, "plugins"), "entries"), "memory-core");
  child(child(memoryCore, "config"), "dreaming").enabled = false;

  // --- Defaulted: capacity (the 2026.7.1 values, sized for one H100) --------
  const defaults = child(child(root, "agents"), "defaults");
  defaultTo(defaults, "maxConcurrent", 4);
  defaultTo(child(defaults, "subagents"), "maxSpawnDepth", 1);
  defaultTo(defaults, "bootstrapMaxChars", AGENTS_MD_MAX_CHARS);
  // "" = no separate utility model: titles use the primary model and progress
  // narration stays off. Unset, OpenClaw derives a provider default — for the
  // `openai` provider id that is a hosted OpenAI model our endpoint never serves.
  defaultTo(defaults, "utilityModel", "");
  defaultTo(child(root, "mcp"), "sessionIdleTtlMs", 10 * 60 * 1000);

  // --- Defaulted: only the plugins a tenant uses are loaded ------------------
  // Unset, OpenClaw loads every bundled plugin that is on by default — a dozen
  // at 2026.9.8 (computer use, device pairing, node file transfer, GitHub,
  // hosted-provider tools…), and a later release can add more. An allowlist
  // turns "whatever upstream enables" into a list someone chose. Plugins the
  // operator has explicitly enabled are kept; a plugin installed later has to
  // be added to `plugins.allow` by whoever installs it.
  const plugins = child(root, "plugins");
  if (plugins.allow === undefined) {
    const entries = (plugins.entries ?? {}) as Record<string, { enabled?: unknown } | undefined>;
    const chosen = Object.keys(entries).filter((id) => entries[id]?.enabled === true);
    plugins.allow = [...new Set([...TENANT_PLUGINS, ...chosen])].sort();
  }

  // --- Defaulted: Tool Search ------------------------------------------------
  // On, OpenClaw offers MCP tools through tool_search / tool_describe /
  // tool_call instead of sending every schema on every request. The portal
  // understands both shapes (tool-call-wrapper.ts) and the probe checks both.
  // Off here until it has been tried against the real model; flip this
  // default, or set `tools.toolSearch: true` on a tenant, to turn it on.
  defaultTo(tools, "toolSearch", false);

  // --- Defaulted: memory search stays keyword-only ---------------------------
  // "none" = full-text search with no embedding provider. Unset, OpenClaw
  // embeds every agent's memory files and transcripts with `openai` /
  // text-embedding-3-small after each turn — and on a tenant the `openai`
  // provider id is the self-hosted endpoint, which serves no such model. An
  // operator who wires up a real embedding provider sets this and keeps it.
  defaultTo(child(child(root, "memory"), "search"), "provider", "none");
}

/** The baseline keys that differ from `cfg`, as dotted paths — for diagnostics. */
export function tenantBaselineDrift(cfg: ConfigBlob): string[] {
  const before = JSON.parse(JSON.stringify(cfg)) as Json;
  const after = JSON.parse(JSON.stringify(cfg)) as Json;
  applyTenantBaseline(after as ConfigBlob);
  const drift: string[] = [];
  const walk = (a: unknown, b: unknown, path: string) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    const bothObjects =
      a && b && typeof a === "object" && typeof b === "object" &&
      !Array.isArray(a) && !Array.isArray(b);
    if (!bothObjects) {
      drift.push(path);
      return;
    }
    const keys = new Set([...Object.keys(a as Json), ...Object.keys(b as Json)]);
    for (const k of keys) {
      walk((a as Json)[k], (b as Json)[k], path ? `${path}.${k}` : k);
    }
  };
  walk(before, after, "");
  return drift.sort();
}
