import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraApiClient } from "../jira-client.js";
import { handleToolCall, formatData } from "../tool-helpers.js";

const API = "/rest/api/3";

interface JiraUser {
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
  active?: boolean;
  accountType?: string;
}

export function registerUserTools(server: McpServer, jira: JiraApiClient): void {
  server.tool(
    "myself",
    "Return the connected Atlassian account's profile (accountId, displayName, email).",
    {},
    async () =>
      handleToolCall(async () => {
        const r = await jira.request<JiraUser>(`${API}/myself`);
        return formatData(r);
      }),
  );

  server.tool(
    "lookup_user_by_email",
    "Find a Jira user by their email address. Returns 0 or 1 matches. Use this to convert an email to an accountId for assign_issue / create_issue.",
    {
      email: z.string(),
    },
    async ({ email }) =>
      handleToolCall(async () => {
        const r = await jira.request<JiraUser[]>(`${API}/user/search`, {
          query: { query: email, maxResults: 5 },
        });
        const exact = (r ?? []).find(
          (u) => u.emailAddress?.toLowerCase() === email.toLowerCase(),
        );
        return formatData({
          match: exact ?? null,
          others: (r ?? []).filter((u) => u !== exact),
        });
      }),
  );

  server.tool(
    "search_users",
    "Search Jira users by free-text query (matches across name + email).",
    {
      query: z.string(),
      max: z.number().int().min(1).max(100).optional(),
    },
    async ({ query, max }) =>
      handleToolCall(async () => {
        const r = await jira.request<JiraUser[]>(`${API}/user/search`, {
          query: { query, maxResults: max ?? 25 },
        });
        return formatData(r ?? []);
      }),
  );

  server.tool(
    "list_assignable_users",
    "List users who can be assigned to a specific issue (or to issues in a specific project). Useful before assign_issue.",
    {
      issue_key: z.string().optional(),
      project_key: z.string().optional(),
      query: z.string().optional(),
      max: z.number().int().min(1).max(100).optional(),
    },
    async ({ issue_key, project_key, query, max }) =>
      handleToolCall(async () => {
        if (!issue_key && !project_key) {
          throw new Error(
            "list_assignable_users: pass issue_key or project_key",
          );
        }
        const r = await jira.request<JiraUser[]>(
          `${API}/user/assignable/search`,
          {
            query: {
              issueKey: issue_key,
              project: project_key,
              query: query,
              maxResults: max ?? 25,
            },
          },
        );
        return formatData(r ?? []);
      }),
  );
}
