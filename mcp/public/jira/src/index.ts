#!/usr/bin/env node
/**
 * FlatClaw per-user Jira MCP — REST against Atlassian Cloud Jira API v3.
 *
 * One process per FlatClaw user. Pulls the user's email + workspace URL +
 * API token from the portal cap-token bridge at
 * `${PORTAL_BASE_URL}/api/internal/jira-token`, then talks directly to
 * `<workspace>/rest/api/3/...`.
 *
 * Tool surface (~25 tools, inspired by Atlassian's official MCP):
 *   issues   : search, get, create, update, list_transitions,
 *              transition, add_comment, list_comments, assign,
 *              add_worklog, list_links, create_link, list_link_types
 *   projects : list_projects, get_project, list_project_issue_types,
 *              list_project_statuses, list_project_components,
 *              list_project_versions
 *   users    : myself, lookup_user_by_email, search_users,
 *              list_assignable_users
 *
 * Toolset gating via JIRA_MCP_TOOLSET=core|full so dev-lane (Gemma 4 E4B,
 * 32k ctx) doesn't blow its prompt budget.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { compactDescription, compactParamsSchema } from "./tool-compress.js";
import { wrapServerForCatalog } from "./catalog-wrapper.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JiraApiClient } from "./jira-client.js";
import { parseApprovalTools, pendingApprovalResult } from "./approval.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerUserTools } from "./tools/users.js";
import { registerAttachmentTools } from "./tools/attachments.js";
import { registerRawTools } from "./tools/raw.js";

/**
 * Core toolset for 32k-ctx dev models — covers daily issue ops without
 * the metadata / link / project-admin tail.
 */
const CORE_TOOLS = new Set([
  // issues — read + the most common writes
  "search_issues",
  "get_issue",
  "create_issue",
  "update_issue",
  "list_transitions",
  "transition_issue",
  "add_comment",
  "list_comments",
  "assign_issue",
  // attachments — common during ticket triage
  "list_issue_attachments",
  "download_attachment",
  // raw escape hatch — covers anything the structured tools miss
  "jira_request",
  // projects — minimum to discover what to search/create against
  "list_projects",
  // users — at minimum the "who am I + how do I find an accountId"
  "myself",
  "lookup_user_by_email",
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
      "[jira-mcp] PORTAL_BASE_URL and CAPABILITY_TOKEN env vars are required",
    );
    process.exit(1);
  }

  const toolset = (process.env.JIRA_MCP_TOOLSET ?? "full").toLowerCase();
  const jira = new JiraApiClient(portalBase, capToken);

  const baseServer = new McpServer({
    name: "jira-mcp-server",
    version: "0.1.0",
  });

  // Wrap order: catalog around bare, filter around catalog. See cpanel
  // index.ts for why (meta-tools must bypass the toolset filter).
  const mode = (process.env.JIRA_MCP_MODE ?? "verbose").toLowerCase();
  const catalogServer = wrapServerForCatalog(baseServer, {
    prefix: "jira",
    mode,
  });
  // Approval-gated tools: composed, never executed by the agent (see approval.ts).
  const approvalTools = parseApprovalTools(process.env.JIRA_APPROVAL_TOOLS);

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
    if (approvalTools.has(name)) {
      if (typeof args[1] === "string") {
        args[1] =
          `HUMAN-APPROVAL GATED: this composes the request and pauses for sign-off in the FlatClaw approvals queue — it never executes directly. ${args[1]}`;
      }
      const hIdx = args.length - 1;
      const handler = args[hIdx];
      if (typeof handler === "function") {
        args[hIdx] = async (...hargs: unknown[]) => {
          jira.armCompose();
          try {
            const res = await (handler as (...a: unknown[]) => Promise<unknown>)(...hargs);
            // The client captures the first mutating call whether or not the
            // handler swallowed the abort into its own error result.
            const composed = jira.takeComposed();
            if (composed) {
              return pendingApprovalResult({ tool: name, args: hargs[0], composed });
            }
            return res; // no mutation attempted (reads / validation error) — pass through
          } finally {
            jira.disarmCompose();
          }
        };
      }
    }
    return catalogTool(...(args as Parameters<typeof catalogTool>));
  }) as typeof baseServer.tool;
  const server = new Proxy(catalogServer, {
    get(target, prop, receiver) {
      if (prop === "tool") return filteredTool;
      return Reflect.get(target, prop, receiver);
    },
  });

  console.error(`[jira-mcp] registering tools (toolset=${toolset})`);

  registerIssueTools(server, jira);
  registerProjectTools(server, jira);
  registerUserTools(server, jira);
  registerAttachmentTools(server, jira);
  registerRawTools(server, jira);

  console.error("[jira-mcp] tools registered, starting transport");

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    console.error("[jira-mcp] shutdown");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.error("[jira-mcp] running on stdio");
}

main().catch((err) => {
  console.error("[jira-mcp] FATAL", err);
  process.exit(1);
});
