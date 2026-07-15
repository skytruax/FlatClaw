import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraApiClient } from "../jira-client.js";
import { handleToolCall, formatData } from "../tool-helpers.js";

/**
 * Generic authenticated Jira REST escape hatch — same idea as Atlassian's
 * official MCP `fetch` tool. Use sparingly: prefer the structured tools
 * when one exists. Reach for `jira_request` when you need an endpoint
 * we don't wrap (dashboards, agile boards/sprints, customfield CRUD,
 * custom screens, etc.) or for very recent API additions.
 *
 * Auth + base URL come from the user's stored credentials via the
 * cap-token bridge — no plaintext tokens, no manual workspace URL.
 */

export function registerRawTools(server: McpServer, jira: JiraApiClient): void {
  server.tool(
    "jira_request",
    "Make an arbitrary authenticated REST call to the user's Jira workspace. Use this for anything the structured tools don't cover (dashboards, boards/sprints, fields, screens, etc.). Path can be relative (`/rest/api/3/dashboard`) or shorthand (`dashboard` → auto-prefixed with `/rest/api/3/`). Authenticated via the user's stored credentials.",
    {
      method: z
        .enum(["GET", "POST", "PUT", "DELETE"])
        .describe("HTTP method. Default: GET."),
      path: z
        .string()
        .describe(
          "Path relative to the workspace base URL. Examples: '/rest/api/3/dashboard', 'rest/api/3/serverInfo', 'dashboard' (auto-prefixed with /rest/api/3/), '/rest/agile/1.0/board' (uses Atlassian's agile API surface).",
        ),
      query: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe("Query string params keyed by name, e.g. {expand: 'names'}."),
      json: z
        .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
        .optional()
        .describe(
          "JSON body for POST/PUT requests. Caller is responsible for the right shape (consult Atlassian's docs for the endpoint).",
        ),
    },
    async ({ method, path, query, json }) =>
      handleToolCall(async () => {
        // Normalize path:
        //   '/rest/...' or 'rest/...' → use as-is
        //   anything else → assume it's a v3 endpoint and prepend '/rest/api/3/'
        let full = path.trim();
        if (!full.startsWith("/")) full = "/" + full;
        if (!full.startsWith("/rest/")) {
          full = "/rest/api/3/" + full.replace(/^\/+/, "");
        }
        // Coerce query to string-only (jira-client expects that shape).
        const q: Record<string, string> = {};
        for (const [k, v] of Object.entries(query ?? {})) {
          q[k] = String(v);
        }
        const result = await jira.request(full, {
          method: method ?? "GET",
          query: q,
          json,
        });
        return formatData(result);
      }),
  );
}
