import { getGatewayClient } from "./adapter";

/**
 * Skill-related openclaw config helpers.
 *
 * The portal owns three things in openclaw config:
 *   1. Tenant baseline knobs — `agents.defaults.{verboseDefault,thinkingDefault}`,
 *      browser disable. Set once via `ensureGlobalConfig`.
 *   2. Tenant skill allowlist — `agents.defaults.skills`. Source of truth is
 *      our `tenant_skill_settings` table; materialized into openclaw config
 *      by `lib/openclaw/tenant-skills.ts`. NOT touched here.
 *   3. Per-user MCP servers — `mcp.servers.<prefix><safeAgentId>`. Owned by
 *      `lib/openclaw/managed-mcp.ts`.
 *
 * What we deliberately do NOT touch: `skills.entries.<name>.enabled`. That's
 * openclaw's own opinion about whether a bundled skill is operational on this
 * host. Operators manage it via openclaw's control UI directly. Our tenant
 * policy layers on top via the per-agent allowlist.
 *
 * Note: there is no longer any "gog" CLI in the FlatClaw deployment. The
 * per-user `google-<safeAgentId>` MCP at `mcp/public/google/` talks directly to
 * Gmail / Drive / Calendar / Docs / Sheets / People REST APIs using the
 * cap-token bridge for fresh access tokens. The legacy
 * `skills.entries.gog.env.GOG_KEYRING_*` tenant-global env has been
 * retired entirely.
 */

interface SkillGlobalEntry {
  enabled?: boolean;
  env?: Record<string, string>;
  apiKey?: string | null;
}

interface AgentListEntry {
  id: string;
  skills?: string[];
  [k: string]: unknown;
}

interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  [k: string]: unknown;
}

interface ConfigBlob {
  agents?: {
    list?: AgentListEntry[];
    defaults?: { skills?: string[]; verboseDefault?: string; [k: string]: unknown };
    [k: string]: unknown;
  };
  skills?: { entries?: Record<string, SkillGlobalEntry>; [k: string]: unknown };
  plugins?: {
    entries?: Record<string, { enabled?: boolean; [k: string]: unknown }>;
    [k: string]: unknown;
  };
  mcp?: { servers?: Record<string, McpServerEntry>; [k: string]: unknown };
  browser?: { enabled?: boolean; [k: string]: unknown };
  [k: string]: unknown;
}

interface ConfigGetResult {
  config: ConfigBlob | string;
  hash?: string;
  baseHash?: string;
  raw?: string;
}

function getJsonBlob(value: unknown): ConfigBlob {
  if (typeof value === "string") return JSON.parse(value) as ConfigBlob;
  return (value as ConfigBlob) ?? {};
}

/**
 * Returns the effective skill allowlist openclaw will apply to this agent at
 * its next session start. Per openclaw's `resolveEffectiveAgentSkillFilter`:
 *
 *   - if `agents.list[i].skills` is an array → that wins
 *   - else if `agents.defaults.skills` is an array → falls back to that
 *   - else → no filter (every globally-enabled skill is visible)
 *
 * Used by `syncSkillsForUser` to drive AGENTS.md/TOOLS.md content. The
 * tenant baseline lives in `agents.defaults.skills`, populated by
 * `tenant-skills.ts`. Per-agent overrides exist only when an operator
 * has hand-scoped a specific user (rare).
 */
export async function readEffectiveSkillAllowlist(
  agentId: string,
): Promise<string[]> {
  const client = getGatewayClient();
  const r = (await client.call("config.get", {})) as ConfigGetResult;
  const blob = getJsonBlob(r.config ?? r.raw);
  const agentEntry = blob.agents?.list?.find((a) => a.id === agentId);
  if (Array.isArray(agentEntry?.skills)) return [...agentEntry.skills];
  if (Array.isArray(blob.agents?.defaults?.skills))
    return [...blob.agents.defaults.skills];
  return [];
}

/**
 * Ensures the gateway-wide config has the tenant baseline knobs the portal
 * relies on:
 *
 *   - browser disabled (we don't ship the browser tool)
 *   - agents.defaults.{verboseDefault, thinkingDefault} set
 *   - legacy `mcp.servers.cpanel` entry cleanup (was a single-host MCP
 *     before per-user provisioning)
 *
 * Does NOT manage:
 *   - `agents.defaults.skills` — owned by `tenant-skills.ts`
 *   - `skills.entries.<name>.enabled` — owned by openclaw's control UI;
 *     operators flip skills there directly
 *   - `mcp.servers.<prefix><user>` — owned by `managed-mcp.ts`
 *
 * Idempotent — no-ops when everything is in shape, so calling on every
 * provision only writes once.
 */
export async function ensureGlobalConfig(): Promise<void> {
  const client = getGatewayClient();
  const r = (await client.call("config.get", {})) as ConfigGetResult;
  const blob = getJsonBlob(r.config ?? r.raw);
  const before = JSON.stringify(blob);

  // Tenant defaults: verbose + reasoning. The skill allowlist is NOT
  // written here — `tenant-skills.ts` owns that path.
  blob.agents = blob.agents ?? {};
  blob.agents.defaults = blob.agents.defaults ?? {};
  if (blob.agents.defaults.verboseDefault !== "full") {
    blob.agents.defaults.verboseDefault = "full";
  }
  // The H100/Gemma model is capable of deep reasoning, and the portal's
  // UX folds the trace into a collapsible "Thinking" block.
  if (blob.agents.defaults.thinkingDefault !== "high") {
    blob.agents.defaults.thinkingDefault = "high";
  }

  // Browser tool disabled (both the top-level flag and the plugin entry).
  blob.browser = blob.browser ?? {};
  if (blob.browser.enabled !== false) blob.browser.enabled = false;
  blob.plugins = blob.plugins ?? {};
  blob.plugins.entries = blob.plugins.entries ?? {};
  const browserPlugin = blob.plugins.entries.browser ?? {};
  if (browserPlugin.enabled !== false) {
    blob.plugins.entries.browser = { ...browserPlugin, enabled: false };
  }

  // cPanel MCP servers are now per-user — provisioned by
  // `provisionCpanelMcpForUser` when an admin saves vault creds, named
  // `cpanel-<safeAgentId>` so each user's MCP runs with its own capability
  // token. The legacy single-host `mcp.servers.cpanel` registration is
  // dropped here for any config still carrying it from earlier dev runs.
  if (blob.mcp?.servers?.cpanel) {
    delete blob.mcp.servers.cpanel;
  }

  const after = JSON.stringify(blob);
  if (after === before) return; // already in shape — no reload triggered

  // Diagnostic: show the first character offset where before/after diverge.
  // Only logs when we actually decide to write, so it's quiet on no-op runs.
  let div = -1;
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    if (before[i] !== after[i]) {
      div = i;
      break;
    }
  }
  if (div === -1) div = Math.min(before.length, after.length);
  console.warn(
    "[ensureGlobalConfig] writing config — diff @",
    div,
    "before:",
    before.slice(Math.max(0, div - 30), div + 60),
    "after:",
    after.slice(Math.max(0, div - 30), div + 60),
  );

  await client.call("config.set", {
    raw: after,
    baseHash: r.hash ?? r.baseHash,
  });
  await client.waitUntilReady();
}

/**
 * Build AGENTS.md — the agent's primary context/instruction file (akin to
 * CLAUDE.md). This is what the agent loads at session start to know who it
 * is, what FlatClaw is, and which tools it has.
 */
export function buildAgentsMd(args: {
  identityName: string;
  email: string;
  /**
   * Agent id — drives the on-disk workspace path
   * (`~/.openclaw/workspace-<agentId>/`). Required so the agent can use
   * absolute paths in `write`/`exec` calls and they actually resolve.
   */
  agentId: string;
  enabledSkillIds: string[];
  /**
   * Per-user cpanel MCP server name (e.g. `cpanel-skyler-flatclaw-org`).
   * Empty/undefined = no per-user cpanel MCP — agent isn't told about it.
   */
  cpanelMcpServerName?: string | null;
  /** cpanel username this agent acts as. Informational. */
  cpanelUsername?: string | null;
  /**
   * Per-user google MCP server name (e.g. `google-skyler-truax-gmail-com`).
   * Empty/undefined = the user hasn't connected Google yet — no Google
   * tools are mentioned in the prompt.
   */
  googleMcpServerName?: string | null;
  /** The user's connected Google account email. Informational. */
  googleEmail?: string | null;
  /**
   * Generic per-service capability bullets contributed by managed-MCP plugins
   * via their `buildAgentsSection` hook (e.g. a private add-on service). Folded
   * into the capability list without the builder naming any specific service.
   */
  extraServiceSections?: string[];
  /**
   * When true: this agent is the *primary router*. Service work goes
   * through `sessions_spawn` to focused subagents (`<agentId>-cpanel`,
   * `-caldav`, `-google`, `-jira`). Direct service-MCP tool calls are
   * denied at the policy pipeline.
   */
  subagentsMode?: boolean;
}): string {
  const enabled = new Set(args.enabledSkillIds);
  const subagents = !!args.subagentsMode;
  const capabilities: string[] = [];
  if (subagents) {
    capabilities.push(
      `- **Spawn focused subagents** via \`sessions_spawn\` for service work. Each subagent (\`${args.agentId}-cpanel\`, \`${args.agentId}-caldav\`, \`${args.agentId}-google\`, \`${args.agentId}-jira\`) runs in its own session with only its own service's tool schemas — keeps your context tiny. You read the subagent's result and translate it into a user-facing answer.`,
    );
  }
  if (args.googleMcpServerName && !subagents) {
    const p = `${args.googleMcpServerName}__`;
    const acctNote = args.googleEmail
      ? ` They act on the Google account **${args.googleEmail}** — never another user's.`
      : "";
    capabilities.push(
      `- **Google services** (Gmail, Calendar, Drive, Docs, Sheets, Contacts) via \`${p}*\` tools — structured tool calls, not shell commands. e.g. \`${p}gmail_search\`, \`${p}gmail_send\`, \`${p}drive_ls\`, \`${p}calendar_events\`, \`${p}docs_cat\`.${acctNote}`,
    );
  }
  if (enabled.has("github") || enabled.has("gh-issues")) {
    capabilities.push(
      `- **GitHub** via the \`gh\` shell binary. Invoke through the \`exec\` tool, e.g. \`exec\` with command \`gh repo list <owner>\`. Pre-authenticated on this host.`,
    );
  }
  if (args.cpanelMcpServerName && !subagents) {
    // openclaw's pi-embedded-runner exposes MCP tools as
    // `<safeServerName>__<toolName>` — no `mcp__` prefix, hyphens preserved
    // (see openclaw/src/agents/pi-bundle-mcp-names.ts). Claude Desktop / CLI
    // adds `mcp__` on its side; the embedded runner FlatClaw runs against
    // never does.
    const cpanelPrefix = `${args.cpanelMcpServerName}__`;
    const cpanelUserNote = args.cpanelUsername
      ? ` These tools act on the cPanel account **${args.cpanelUsername}** — your own hosting slice. They will never touch other users' accounts.`
      : "";
    capabilities.push(
      `- **cPanel hosting** (files, email accounts, DNS, MySQL, FTP, PHP, SSL, backups) via \`${cpanelPrefix}*\` tools — structured tool calls, not shell commands. e.g. \`${cpanelPrefix}list_email_accounts\`, \`${cpanelPrefix}upload_file\`, \`${cpanelPrefix}get_dns_records\`.${cpanelUserNote}`,
    );
  }
  if (!subagents && args.extraServiceSections?.length) {
    for (const s of args.extraServiceSections) capabilities.push(s);
  }
  const workspacePath = `~/.openclaw/workspace-${args.agentId}/`;
  capabilities.push(
    `- **Shell + filesystem** in your own workspace at \`${workspacePath}\` via the built-in \`read\`/\`write\`/\`edit\`/\`exec\` tools. To change an existing file, \`edit({ path, old_string, new_string })\` — a small search-replace patch; **do NOT \`write\`** (that overwrites the whole file and you'd have to regenerate all of it). \`write({ path, content })\` is for *new* files only. See TOOLS.md.`,
  );
  const capList = capabilities.length > 0 ? capabilities.join("\n") : "- (no services connected yet — ask your admin)";
  return `---
summary: "FlatClaw agent context — who you are and what you can do"
title: "AGENTS"
read_when:
  - Session start
  - Whenever you're unsure which tool to reach for
---

# I am ${args.identityName}'s personal AI agent

## My workspace

My home on disk is **\`${workspacePath}\`** — that's where my files live and
where I should write notes, drafts, downloads, scratch work, and memory.
**When ${args.identityName} mentions a file by name, look there first** with
the \`read\` tool (or \`exec ls\` if I need to browse). Their attachments
appear in this directory too.

If a path is relative, resolve it against my workspace, not against \`/\` or
my user home.

## What FlatClaw is

FlatClaw is a multi-tenant AI portal. One human, one AI agent (me), one inbox to work out of together. My human is **${args.identityName}** (${args.email}). I act on their behalf.

Other agents on this gateway serve other humans. Stay in your lane: read and write only inside my own workspace above, send mail only from my own connected accounts, and never assume credentials or tools that aren't mine.

## What I can do

${capList}

## What I should NOT do

- **Do NOT use the \`browser\` tool.** It's been disabled. For Google services, reach for the \`${args.googleMcpServerName ? `${args.googleMcpServerName}__*` : "google"}\` tool family${args.cpanelMcpServerName ? `; for cPanel hosting use \`${args.cpanelMcpServerName}__*\`` : ""}.
- **Do NOT invent OAuth flows, ask the user to paste tokens, or try to authenticate yourself.** Auth is already wired through the portal. The Google and cPanel tools fetch fresh credentials per call from a loopback endpoint; you don't see or handle them.
- **Do NOT touch credential files** like \`~/.openclaw/credentials/*\` or anything that looks like a token store. If a tool errors with a credential problem, surface the error verbatim to ${args.identityName} — don't try to repair it yourself.
- **Do NOT call any tool whose name doesn't begin with one of:** \`read\`, \`write\`, \`edit\`, \`exec\`${args.googleMcpServerName ? `, \`${args.googleMcpServerName}\`` : ""}${args.cpanelMcpServerName ? `, \`${args.cpanelMcpServerName}\`` : ""}. Tool names starting with another user's prefix (e.g. \`google-someoneelse__*\` or \`cpanel-someoneelse__*\`) are not yours and will be rejected.
- Do NOT send email from any address other than your connected Google account${args.googleEmail ? ` (\`${args.googleEmail}\`)` : ""}.

## Time & dates — ALWAYS check, never assume

Whenever a task involves a date or time — "tomorrow morning", "this Friday",
"newer_than:7d", building an RFC3339 timestamp for a calendar event, deciding
"is this email from today" — **first call \`exec\` with this exact command
and use its output**:

\`\`\`
node -e 'const d=new Date(); console.log(JSON.stringify({iso:d.toISOString(),localISO:d.toString(),unixMs:d.getTime(),tz:Intl.DateTimeFormat().resolvedOptions().timeZone}))'
\`\`\`

Why: your training data has a stale cutoff and the heartbeat tag is the
*delivery* time, not "now" when you act. Hallucinating dates causes calendar
invites for the wrong day and "tomorrow" reminders that are already in the
past. The \`exec\`-based \`new Date()\` reads the host clock and is always
correct.

For relative computations ("3 days from now", "last Monday", "next Tuesday at
9 AM in user's timezone") use the same \`exec\` pattern with the math inline,
e.g. \`node -e 'const d=new Date(Date.now()+3*86400000); console.log(d.toISOString())'\`.
Pass ISO timestamps to calendar tools — never freeform strings like
"tomorrow at 9".

## Memory

You wake up fresh each session. Persist anything that should survive:

- **Daily notes:** \`memory/YYYY-MM-DD.md\` — raw logs of what happened today
- **Long-term:** \`MEMORY.md\` — curated facts about ${args.identityName}, decisions, preferences

Write things down. "Mental notes" don't survive restarts; files do.

## When in doubt

Ask ${args.identityName}. They're at ${args.email} and they're the one chatting with you.
`;
}

/** Build the TOOLS.md content reflecting the agent's currently-enabled skills. */
export function buildToolsMd(args: {
  identityName: string;
  agentId: string;
  enabledSkillIds: string[];
  cpanelMcpServerName?: string | null;
  cpanelUsername?: string | null;
  googleMcpServerName?: string | null;
  googleEmail?: string | null;
  /** Generic per-service tool bullets from plugins' `buildToolsSection` hook. */
  extraServiceSections?: string[];
  /**
   * Catalog mode reduces each per-user MCP from N tool schemas to 3 meta-tools
   * (`<svc>_help` / `<svc>_describe` / `<svc>_call`). When true, we teach the
   * agent to discover via `_help` and dispatch via `_call`. When false (verbose
   * mode) we keep the direct-call instructions so the model uses tools by name.
   */
  catalogMode?: boolean;
  /**
   * Subagent mode: primary agent denies all service MCPs and dispatches via
   * `sessions_spawn` to per-(user, service) subagents. AGENTS.md / TOOLS.md
   * teach the routing pattern instead of direct tool calls.
   */
  subagentsMode?: boolean;
}): string {
  const workspacePath = `~/.openclaw/workspace-${args.agentId}/`;
  const enabled = new Set(args.enabledSkillIds);
  const sections: string[] = [];
  const catalog = !!args.catalogMode;
  const subagents = !!args.subagentsMode;

  sections.push(`# TOOLS

How ${args.identityName} should think about reaching for tools.

> **IMPORTANT:** Tool names that begin with a service prefix (e.g.
> \`${args.googleMcpServerName ?? "google-<your-id>"}__*\`${args.cpanelMcpServerName ? `, \`${args.cpanelMcpServerName}__*\`` : ""}) are STRUCTURED tools — call them
> directly by name, with their declared arguments. They are NOT shell
> commands. \`gh\` (and any other CLI mentioned below) IS a shell binary
> that you invoke through the \`exec\` tool.
>
> Do NOT print \`\`\`bash blocks or \`exec({...})\` pseudocode in your
> reply and wait for the human to run them. If you want a command run, you
> call the tool. If you only want to suggest one, say so in plain prose.

${
  subagents
    ? `## Subagent dispatch — your primary mode of working

You are a **router**. You don't carry every service's tool schemas in your
context — that would burn ~50 k tokens before you typed anything. Instead,
when you need to do work for a specific service, you **spawn a focused
subagent** with \`sessions_spawn\`:

- **Email / Calendar / Drive / Docs / Sheets / Contacts** → \`sessions_spawn({ task: "<one-line description>", agentId: "${args.agentId}-google" })\`
- **cPanel hosting** (files, DNS, MySQL, PHP, SSL, FTP, email accounts) → \`sessions_spawn({ task: "...", agentId: "${args.agentId}-cpanel" })\`
- **Mailbox / CalDAV / CardDAV / IMAP / SMTP** → \`sessions_spawn({ task: "...", agentId: "${args.agentId}-caldav" })\`
- **Jira / tickets / sprints / boards** → \`sessions_spawn({ task: "...", agentId: "${args.agentId}-jira" })\`

Subagents are leaves — they run with focused tool schemas, do the work, and
report back via a final assistant message you can quote in your reply. You
**read the subagent's result** and translate it into a user-facing answer.

You DO have direct access to: \`read\`, \`write\`, \`edit\`, \`grep\`,
\`exec\` — for working in your own workspace at \`${workspacePath}\`. These
are bundled tools, not service-specific.

## When you need to…
`
    : "## When you need to…\n"
}`);

  if (args.googleMcpServerName && !subagents) {
    const p = `${args.googleMcpServerName}__`;
    if (catalog) {
      sections.push(
        `- **Gmail / Calendar / Drive / Docs / Sheets / Contacts** → start with \`${p}google_help({ query? })\` to discover available tools, then \`${p}google_describe({ tool })\` for a tool's params, then \`${p}google_call({ tool, args })\` to invoke. The full tool roster is hidden from your tool list to save context.`,
      );
    } else {
      sections.push(
        `- **Gmail / Calendar / Drive / Docs / Sheets / Contacts** → call the \`${p}*\` tools directly. e.g. \`${p}gmail_search\`, \`${p}drive_ls\`, \`${p}calendar_events\`.`,
      );
    }
  }
  if (enabled.has("github") || enabled.has("gh-issues")) {
    sections.push(
      `- **GitHub repos, PRs, issues** → invoke the \`exec\` tool with a \`gh\` command. The CLI is already authenticated on this host.`,
    );
  }
  if (args.cpanelMcpServerName && !subagents) {
    const prefix = `${args.cpanelMcpServerName}__`;
    if (catalog) {
      sections.push(
        `- **cPanel hosting actions** (files, email accounts, DNS, MySQL, FTP, PHP, SSL, backups) → start with \`${prefix}cpanel_help({ query? })\`, then \`${prefix}cpanel_describe({ tool })\`, then \`${prefix}cpanel_call({ tool, args })\`. Full tool roster is hidden from your tool list — discover via _help, invoke via _call.`,
      );
    } else {
      sections.push(
        `- **cPanel hosting actions** (files, email accounts, DNS records, MySQL/Postgres databases, FTP, PHP, SSL, backups) → call the \`${prefix}*\` tools directly. They're structured tools, not shell commands.`,
      );
    }
  }
  if (!subagents && args.extraServiceSections?.length) {
    for (const s of args.extraServiceSections) sections.push(s);
  }
  sections.push(
    `- **Run any other shell command** → use \`exec\`. Prefer it for ad-hoc filesystem and process work inside your workspace.`,
  );
  sections.push(
    `- **Read a file in your workspace** → \`read({ path })\`. Workspace is at \`${workspacePath}\`. Don't shell out to \`cat\`.`,
    `- **Change an EXISTING file** → \`edit({ path, old_string, new_string })\` — a small search-and-replace patch. Pass just the snippet you're replacing and what to replace it with. **Do NOT use \`write\` to "make changes"** — \`write\` overwrites the *whole* file with new \`content\`, so for an edit you'd have to regurgitate the entire file, which is slow and error-prone (and a malformed/empty \`content\` will be rejected). One small \`edit\` per change.`,
    `- **Create a NEW file (or fully replace a small one)** → \`write({ path, content })\` — \`content\` is the complete file body. Reserve \`write\` for new files; use \`edit\` for changes to files that already exist.`,
    `- Both \`path\`/\`old_string\`/\`new_string\` (for \`edit\`) and \`path\`/\`content\` (for \`write\`) are **required** — never call these tools with empty args.`,
  );

  // ---- common multi-step patterns ---------------------------------
  // The model frequently knows about each tool family in isolation
  // but doesn't connect them — e.g. "read this from cpanel and copy
  // it to my workspace" requires chaining a service-side read with
  // the built-in `write`. Spell out the chains explicitly.
  //
  // In catalog mode the underlying tool is invoked via
  //   <prefix>_call({ tool: "<name>", args: {...} })
  // not by name directly. The cookbook chains adapt.
  const renderCall = (
    serverPrefix: string,
    serviceTag: string,
    toolName: string,
    argsRender: string,
  ) => {
    if (catalog) {
      return `\`${serverPrefix}${serviceTag}_call({ tool: "${toolName}", args: ${argsRender} })\``;
    }
    return `\`${serverPrefix}${toolName}(${argsRender})\``;
  };
  const cookbookChains: string[] = [];
  if (args.cpanelMcpServerName) {
    const cp = `${args.cpanelMcpServerName}__`;
    cookbookChains.push(
      `- **"copy a file FROM cPanel TO my workspace"** → ${renderCall(cp, "cpanel", "download_file", `{ path: "/public_html/foo.txt" }`)} — server-side stream straight into your workspace. Bytes never go through the model. Don't read_file → write; that wastes context and breaks on big files.`,
      `- **"copy a file FROM my workspace TO cPanel"** → ${renderCall(cp, "cpanel", "upload_file_from_workspace", `{ source: "${workspacePath}foo.txt", path: "/public_html/foo.txt" }`)} — same pattern, server-side. Don't read → create_file.`,
      `- **"download a whole cPanel directory"** → ${renderCall(cp, "cpanel", "download_directory", `{ path: "/public_html/demo" }`)} — recursive server-side copy.`,
      `- **"find / search / look for X across cPanel files"** → ${renderCall(cp, "cpanel", "grep_files", `{ dir: "/public_html", pattern: "<regex>", glob: "*.php" }`)}. Returns matched lines + context. **This is the right tool when the user says "where", "find", "look for", "search". Reach for it BEFORE read_file.**`,
      `- **"find pattern X in this one cPanel file"** → ${renderCall(cp, "cpanel", "grep_file", `{ path: "/public_html/index.php", pattern: "<regex>" }`)} returns matched lines + context. Cheaper than read_file when you only need the lines around a symbol.`,
      `- **"inspect a cPanel file" (small, e.g. config)** → ${renderCall(cp, "cpanel", "read_file", `{ path }`)} — but note: read_file tiers by size. Files ≤32 KB inline; ≤256 KB return head+tail+size header (then call read_file_range or grep_file for the rest); >256 KB are refused — use download_file and read locally instead.`,
      `- **"read a slice / specific lines of a large cPanel file"** → ${renderCall(cp, "cpanel", "read_file_range", `{ path, offset, length }`)} for byte ranges, or ${renderCall(cp, "cpanel", "grep_file", `{ path, pattern }`)} for pattern-anchored slices.`,
      `- **"author or replace a small file on cPanel"** → ${renderCall(cp, "cpanel", "create_file", "{...}")} / ${renderCall(cp, "cpanel", "edit_file", "{...}")} for inline content. For pure copies, prefer the upload/download pair above.`,
    );
  }
  if (args.googleMcpServerName) {
    const g = `${args.googleMcpServerName}__`;
    cookbookChains.push(
      `- **"save this Drive file to my workspace"** → \`${g}drive_download({ file_id, out_path: "${workspacePath}filename" })\` writes directly to your workspace; no chain needed.`,
      `- **"upload this workspace file to my Drive"** → \`${g}drive_upload({ local_path: "${workspacePath}foo.txt", parent_folder_id?: ... })\` reads from your workspace; no chain needed.`,
      `- **"email this workspace file as an attachment"** → 1. \`read({ path: "${workspacePath}foo.txt" })\` to get the bytes. 2. \`${g}gmail_send({ to, subject, body, attachments: [{ filename: "foo.txt", content: <the content> }] })\`.`,
    );
  }
  if (cookbookChains.length > 0) {
    sections.push(`
## Common multi-step patterns

These are the chains people ask for most often. The agent MUST recognise them and call the tools in sequence — no manual copy-paste, no asking the human to do file moves between calls.

${cookbookChains.join("\n")}

The general rule: **service tools fetch/write external data; built-in tools (\`read\`/\`write\`/\`edit\`/\`exec\`) operate on your workspace at \`${workspacePath}\`**.

**Reading large files efficiently — pattern over slurp.** Whether the file is on cPanel, in Drive, or in your workspace: when the question is "where" or "what does X look like in this file", reach for **grep / pattern search FIRST**, then read just the slice you need. Slurping a multi-MB file into context wastes tokens, triggers compaction, and often blows the budget mid-turn.
- "where is the config X set?" → \`grep_file\` or \`grep_files\` first; only \`read_file_range\` around the hit if needed.
- "show me the function that does Y" → \`grep_file\` with \`context_lines\` set, no read_file at all in many cases.
- "is there any reference to Z in this codebase?" → \`grep_files\` with a glob filter; capped, fast, returns just the matches.
- For very large files (>256 KB on cPanel, >50 k tokens anywhere): always download to workspace first, then operate locally with the bundled \`Grep\` and \`Read\` tools, which already do head/tail truncation + ranged reads.

You always have a budget. Treat tool-result bytes as expensive — they sit in your context for the rest of the session unless compacted.`);
  }

  if (args.googleMcpServerName) {
    const p = `${args.googleMcpServerName}__`;
    const acctNote = args.googleEmail
      ? `These tools act on the Google account **${args.googleEmail}** — never another user's.`
      : `These tools act on ${args.identityName}'s connected Google account.`;
    sections.push(`
## Google cookbook — \`${p}*\` tool family

${acctNote} Real structured tools. Call them by name with the listed args.

**Gmail**:
- \`${p}gmail_search\` { query: "in:inbox newer_than:7d", max: 20 }
- \`${p}gmail_get\` { message_id }
- \`${p}gmail_send\` { to, subject, body, cc?, bcc?, body_html?, reply_to_message_id?, thread_id? }
- \`${p}gmail_modify\` { message_id, add: ["STARRED"], remove: ["UNREAD"] }

**Drive**:
- \`${p}drive_ls\` { folder_id?, query?, max? } — root if folder_id omitted
- \`${p}drive_search\` { query, max? } — full-text Drive search
- \`${p}drive_upload\` { local_path, name?, parent_folder_id?, mime_type?, convert? }
- \`${p}drive_download\` { file_id, out_path, format? }
- \`${p}drive_share\` { file_id, email, role: "reader"|"commenter"|"writer", notify? }

**Calendar**:
- \`${p}calendar_events\` { calendar?, today?, tomorrow?, days_ahead?, from?, to?, max? }
- \`${p}calendar_create\` { summary, from, to, description?, location?, attendees?, all_day?, calendar?, timezone? }
- \`${p}calendar_update\` { event_id, summary?, from?, to?, description?, location? }

**Docs**:
- \`${p}docs_cat\` { doc_id, tab?, max_bytes? } — read a Doc as plain text
- \`${p}docs_write\` { doc_id, content, append?, markdown?, tab? }
- \`${p}docs_find_replace\` { doc_id, find, replace, match_case?, first_only?, markdown? }

**Sheets**:
- \`${p}sheets_read\` { spreadsheet_id, range, dimension? }
- \`${p}sheets_append\` { spreadsheet_id, range, values: [[…]], input_option? }

**Contacts**:
- \`${p}contacts_search\` { query, max? }

For multi-line email bodies pass the whole string in \`body\`. To send as a
reply, set \`reply_to_message_id\` — the tool copies the right thread-id +
\`In-Reply-To\` headers automatically. ${args.googleMcpServerName} will refuse
any subcommand outside the per-tool allowlist (defense-in-depth on top of
the per-user MCP isolation).
`);
  }

  if (enabled.has("github") || enabled.has("gh-issues")) {
    sections.push(`
## gh cookbook — shell lines for the \`exec\` tool's \`command\` parameter

- \`gh repo list <owner>\`
- \`gh issue list --repo owner/repo --state open\`
- \`gh pr view <number> --repo owner/repo\`
`);
  }

  if (args.cpanelMcpServerName) {
    const p = `${args.cpanelMcpServerName}__`;
    const acctNote = args.cpanelUsername
      ? `These tools act on the cPanel account **${args.cpanelUsername}** — ${args.identityName}'s own hosting slice on flatclaw.org.`
      : `These tools act on ${args.identityName}'s own cPanel slice.`;
    sections.push(`
## cPanel cookbook — \`${p}*\` tool family

${acctNote} Real structured tools. Call them by name with the listed args.

**Files on the website** (paths relative to the cPanel home dir; \`public_html\` is the doc root):
- \`${p}list_files\` { dir: "/public_html" }
- \`${p}read_file\` { path: "/public_html/index.html" }
- \`${p}edit_file\` { path, content }
- \`${p}create_file\` { path, content }
- \`${p}upload_file\` { local_path, remote_dir } — multipart upload of a workspace file
- \`${p}mkdir\` { parent_dir, name }
- \`${p}move_path\` / \`copy_path\` / \`chmod_path\` / \`delete_file\`
- \`${p}search_files\` { dir, pattern: "*.html" }

**Email**:
- \`${p}list_email_accounts\`
- \`${p}create_email_account\` { email, password, quota }
- \`${p}list_email_forwarders\` / \`create_email_forwarder\` / \`delete_email_forwarder\`
- \`${p}list_autoresponders\` / \`create_autoresponder\`

**DNS** (zone records for a domain):
- \`${p}get_dns_records\` { domain }
- \`${p}add_dns_record\` / \`edit_dns_record\` / \`delete_dns_record\`

**Databases**:
- \`${p}list_mysql_databases\` / \`list_mysql_users\`
- \`${p}create_mysql_database\` / \`create_mysql_user\` / \`set_mysql_privileges\`

**SSL / domains / PHP / cron / FTP / WordPress / version control**: similar shape — list / get / create / delete tools per module. Look for the matching \`${p}*\` name.

**When to reach for these vs \`exec\`:** hosting plumbing → \`${p}*\`. Local workspace shell work → \`exec\`. These tools touch the live hosting account; treat as production.
`);
  }

  // Counter-instruction for the Silent Replies block that openclaw injects
  // immediately after this file. We put it last in TOOLS.md so it's the very
  // last thing the model reads before the NO_REPLY rule, which we want it to
  // ignore for direct human chats. SOUL.md sits too far up the prompt to win
  // last-instruction-wins.
  sections.push(`
---

## CRITICAL: Always Reply to ${args.identityName}

The next section ("Silent Replies") tells you about a \`NO_REPLY\` sentinel.
**That rule does NOT apply when ${args.identityName} addresses you directly.**

When ${args.identityName} sends you a message — greetings ("hi", "hey",
"are you there?"), check-ins, small talk, status questions, conversational
asks — you MUST reply with a real, human-readable answer. **Never** emit
\`NO_REPLY\` for human-to-agent conversation. The silent-reply path is only
for automated heartbeat ticks (which are clearly tagged as such), never for
messages a human typed.

If you're unsure whether a message is human-typed: it almost certainly is.
Reply.

---

These notes are auto-generated by the FlatClaw portal whenever your skills
change. If you want to override behavior, edit \`SOUL.md\` instead — that's
yours to keep.
`);

  return sections.join("\n");
}
