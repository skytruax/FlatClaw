#!/usr/bin/env node
/**
 * FlatClaw per-user Google MCP — REST-only.
 *
 * Toolset gating via `GOOGLE_MCP_TOOLSET=core|full` env. The full surface
 * (58 tools, ~17k tokens of zod schemas) blows a 32k-context model's
 * prompt budget — empirically verified on Gemma 4 E4B. `core` ships
 * ~14 essential tools (~4k tokens). `full` is required on 128k+
 * context models (Gemma 4 31B prod).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { compactDescription, compactParamsSchema } from "./tool-compress.js";
import { wrapServerForCatalog } from "./catalog-wrapper.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GoogleApiClient } from "./google-client.js";
import { registerGmailTools } from "./tools/gmail.js";
import { registerDriveTools } from "./tools/drive.js";
import { registerCalendarTools } from "./tools/calendar.js";
import { registerDocsTools } from "./tools/docs.js";
import { registerSheetsTools } from "./tools/sheets.js";
import { registerPeopleTools } from "./tools/people.js";

/**
 * Core tool set — covers the agent's day-to-day Google work:
 * inbox triage, send/reply, drive ls/search/upload/download, calendar
 * create/list, docs read/write, sheets read/append, contact search.
 * Anything advanced (drafts, labels, threading walks, batch updates,
 * freebusy, find-replace, share, trash, copy, move, rename, contact
 * CRUD) is `full`-only.
 */
const CORE_TOOLS = new Set([
  // gmail — essentials
  "gmail_send",
  "gmail_search",
  "gmail_get",
  "gmail_modify",
  // drive — essentials
  "drive_ls",
  "drive_search",
  "drive_upload",
  "drive_download",
  // calendar — essentials (sendUpdates=all gets iTIP for free)
  "calendar_events",
  "calendar_create_event",
  // docs — essentials
  "docs_get",
  "docs_append",
  // sheets — essentials
  "sheets_read",
  "sheets_append",
  // people — essentials
  "contacts_search",
]);

function shouldRegister(toolset: string, name: string): boolean {
  if (toolset === "core") return CORE_TOOLS.has(name);
  return true;
}

async function main() {
  const portalBase = process.env.PORTAL_BASE_URL;
  const capToken = process.env.CAPABILITY_TOKEN;
  if (!portalBase || !capToken) {
    console.error(
      "[google-mcp] PORTAL_BASE_URL and CAPABILITY_TOKEN env vars are required",
    );
    process.exit(1);
  }

  const toolset = (process.env.GOOGLE_MCP_TOOLSET ?? "full").toLowerCase();
  const api = new GoogleApiClient(portalBase, capToken);

  const baseServer = new McpServer({
    name: "google-mcp-server",
    version: "0.1.0",
  });

  // Wrap order: catalog around bare, filter around catalog. See cpanel
  // index.ts for why this order matters (meta-tools must bypass the
  // toolset filter or they fail shouldRegister and the MCP advertises
  // zero tools, leading to -32601 on tools/list).
  const mode = (process.env.GOOGLE_MCP_MODE ?? "verbose").toLowerCase();
  const catalogServer = wrapServerForCatalog(baseServer, {
    prefix: "google",
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

  console.error(`[google-mcp] registering tools (toolset=${toolset})`);

  registerGmailTools(server, api);
  registerDriveTools(server, api);
  registerCalendarTools(server, api);
  registerDocsTools(server, api);
  registerSheetsTools(server, api);
  registerPeopleTools(server, api);

  console.error("[google-mcp] tools registered, starting transport");

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    console.error("[google-mcp] shutdown");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.error("[google-mcp] running on stdio");
}

main().catch((err) => {
  console.error("[google-mcp] FATAL", err);
  process.exit(1);
});
