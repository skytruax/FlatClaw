#!/usr/bin/env node
/**
 * CalDav MCP — mailbox + calendar + contacts for FlatClaw users.
 *
 * Toolset gating via `CALDAV_MCP_TOOLSET=core|full` env. On a 32k-context
 * model the full surface (40 tools, ~12k tokens of zod schemas) blows
 * the prompt budget before the agent can even respond — empirically
 * verified on Gemma 4 E4B. `core` cuts to ~12 essential tools, leaving
 * ~5k schema tokens. `full` exposes everything; required for 128k+
 * context models like Gemma 4 31B in prod.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { compactDescription, compactParamsSchema } from "./tool-compress.js";
import { wrapServerForCatalog } from "./catalog-wrapper.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCaldavTools } from "./tools/caldav.js";
import { registerCarddavTools } from "./tools/carddav.js";
import { registerImapTools } from "./tools/imap.js";
import { registerSmtpTools } from "./tools/smtp.js";

/**
 * Essential tools for `core` mode — covers the agent's day-to-day:
 * mailbox triage, send + reply, calendar create-with-invite + list,
 * contact search. Anything destructive or batch (delete, expunge,
 * mailbox admin, batch flag, threading walk, etc.) only ships in `full`.
 */
const CORE_TOOLS = new Set([
  // imap (essential read + simple actions)
  "imap_list_mailboxes",
  "imap_list_recent",
  "imap_read_message",
  "imap_search",
  "imap_mark_read",
  "imap_archive",
  "imap_trash",
  // smtp (the demo-critical paths)
  "smtp_send_email",
  "smtp_reply",
  // caldav (the demo-critical paths — invite delivery is the headline)
  "caldav_list_calendars",
  "caldav_list_events",
  "caldav_create_event_with_invite",
  // carddav (just the read path)
  "carddav_list_address_books",
  "carddav_search_contacts",
]);

function shouldRegister(toolset: string, name: string): boolean {
  if (toolset === "core") return CORE_TOOLS.has(name);
  return true;
}

async function main() {
  console.error("[caldav-mcp] booting");

  const toolset = (process.env.CALDAV_MCP_TOOLSET ?? "full").toLowerCase();
  const baseServer = new McpServer({
    name: "caldav-mcp-server",
    version: "0.2.0",
  });

  // Wrap order: catalog around bare, filter around catalog. Meta-tools
  // (caldav_help/_describe/_call) register on the bare server bypassing
  // the toolset filter — otherwise they'd be rejected by shouldRegister
  // and the MCP would respond to initialize() but return -32601 on
  // tools/list because no tools ever got registered. See cpanel/src/index.ts
  // for the same wiring.
  const mode = (process.env.CALDAV_MCP_MODE ?? "verbose").toLowerCase();
  const catalogServer = wrapServerForCatalog(baseServer, {
    prefix: "caldav",
    mode,
  });
  const catalogTool = catalogServer.tool.bind(catalogServer);
  const filteredTool: typeof baseServer.tool = ((...args: unknown[]) => {
    const name = args[0] as string;
    if (!shouldRegister(toolset, name)) {
      return undefined as unknown as ReturnType<typeof catalogTool>;
    }
    if (typeof args[1] === "string") args[1] = compactDescription(args[1]);
    if (
      args[2] &&
      typeof args[2] === "object" &&
      !(args[2] instanceof Function)
    ) {
      compactParamsSchema(args[2] as Record<string, never>);
    }
    return catalogTool(...(args as Parameters<typeof catalogTool>));
  }) as typeof baseServer.tool;
  const server = new Proxy(catalogServer, {
    get(target, prop, receiver) {
      if (prop === "tool") return filteredTool;
      return Reflect.get(target, prop, receiver);
    },
  });

  console.error(`[caldav-mcp] registering tools (toolset=${toolset})`);

  registerCaldavTools(server);
  registerCarddavTools(server);
  registerImapTools(server);
  registerSmtpTools(server);

  console.error("[caldav-mcp] tools registered, starting transport");

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    console.error("[caldav-mcp] shutdown");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.error("[caldav-mcp] running on stdio");
}

main().catch((err) => {
  console.error("[caldav-mcp] FATAL", err);
  process.exit(1);
});
