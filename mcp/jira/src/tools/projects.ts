import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraApiClient } from "../jira-client.js";
import { handleToolCall, formatData } from "../tool-helpers.js";

const API = "/rest/api/3";

interface JiraProject {
  id?: string;
  key?: string;
  name?: string;
  projectTypeKey?: string;
  lead?: { accountId?: string; displayName?: string };
  description?: string;
}

export function registerProjectTools(server: McpServer, jira: JiraApiClient): void {
  server.tool(
    "list_projects",
    "List Jira projects visible to the connected user. Returns key/name/lead/projectType.",
    {
      query: z
        .string()
        .optional()
        .describe("Substring filter on project name + key."),
      max: z.number().int().min(1).max(100).optional(),
    },
    async ({ query, max }) =>
      handleToolCall(async () => {
        const r = await jira.request<{ values?: JiraProject[]; total?: number }>(
          `${API}/project/search`,
          {
            query: {
              query,
              maxResults: max ?? 50,
              expand: "lead,description",
            },
          },
        );
        return formatData(
          (r.values ?? []).map((p) => ({
            id: p.id,
            key: p.key,
            name: p.name,
            type: p.projectTypeKey,
            lead: p.lead?.displayName,
            description: p.description,
          })),
        );
      }),
  );

  server.tool(
    "get_project",
    "Fetch a single project's metadata by key (e.g. 'ASC').",
    { project_key: z.string() },
    async ({ project_key }) =>
      handleToolCall(async () => {
        const r = await jira.request<JiraProject>(
          `${API}/project/${encodeURIComponent(project_key)}`,
        );
        return formatData(r);
      }),
  );

  server.tool(
    "list_project_issue_types",
    "List the issue types configured for a project (e.g. Task, Bug, Story, Epic, Sub-task). Use before create_issue to know what types are valid. For per-type required fields, follow up with get_issue_type_fields. (Atlassian removed the legacy `/issue/createmeta?expand=projects.issuetypes.fields` form in 2024 — this tool uses the per-project replacement at `/issue/createmeta/{key}/issuetypes`.)",
    {
      project_key: z.string(),
    },
    async ({ project_key }) =>
      handleToolCall(async () => {
        const r = await jira.request<{
          issueTypes?: Array<{
            id?: string;
            name?: string;
            description?: string;
            subtask?: boolean;
            iconUrl?: string;
          }>;
        }>(
          `${API}/issue/createmeta/${encodeURIComponent(project_key)}/issuetypes`,
        );
        return formatData(
          (r.issueTypes ?? []).map((it) => ({
            id: it.id,
            name: it.name,
            description: it.description,
            isSubtask: !!it.subtask,
          })),
        );
      }),
  );

  server.tool(
    "get_issue_type_fields",
    "Get the schema (required + allowed fields) for one issue type in a project. Use after list_project_issue_types when you need to know what fields create_issue must supply. Replaces the field-expansion side of the legacy createmeta endpoint.",
    {
      project_key: z.string(),
      issue_type_id: z
        .string()
        .describe("Issue type id (from list_project_issue_types)."),
    },
    async ({ project_key, issue_type_id }) =>
      handleToolCall(async () => {
        const r = await jira.request<{
          fields?: Array<{
            fieldId?: string;
            name?: string;
            required?: boolean;
            schema?: { type?: string; system?: string };
            allowedValues?: unknown[];
            hasDefaultValue?: boolean;
          }>;
        }>(
          `${API}/issue/createmeta/${encodeURIComponent(project_key)}/issuetypes/${encodeURIComponent(issue_type_id)}`,
        );
        return formatData({
          requiredFields: (r.fields ?? [])
            .filter((f) => f.required === true)
            .map((f) => ({ fieldId: f.fieldId, name: f.name, type: f.schema?.type })),
          allFields: (r.fields ?? []).map((f) => ({
            fieldId: f.fieldId,
            name: f.name,
            required: !!f.required,
            type: f.schema?.type,
            hasDefault: !!f.hasDefaultValue,
          })),
        });
      }),
  );

  server.tool(
    "list_project_statuses",
    "List the statuses configured for each issue type in a project. Useful for figuring out what target states transitions can move issues to.",
    { project_key: z.string() },
    async ({ project_key }) =>
      handleToolCall(async () => {
        const r = await jira.request(
          `${API}/project/${encodeURIComponent(project_key)}/statuses`,
        );
        return formatData(r);
      }),
  );

  server.tool(
    "list_project_components",
    "List the components defined under a project.",
    { project_key: z.string() },
    async ({ project_key }) =>
      handleToolCall(async () => {
        const r = await jira.request(
          `${API}/project/${encodeURIComponent(project_key)}/components`,
        );
        return formatData(r);
      }),
  );

  server.tool(
    "list_project_versions",
    "List versions / fix-versions defined under a project.",
    { project_key: z.string() },
    async ({ project_key }) =>
      handleToolCall(async () => {
        const r = await jira.request(
          `${API}/project/${encodeURIComponent(project_key)}/versions`,
        );
        return formatData(r);
      }),
  );
}
