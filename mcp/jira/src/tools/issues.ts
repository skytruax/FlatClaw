import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraApiClient } from "../jira-client.js";
import {
  handleToolCall,
  formatData,
  formatSuccess,
  textToAdf,
  adfToText,
} from "../tool-helpers.js";
import { uploadAttachments } from "./attachments.js";

const API = "/rest/api/3";

const attachmentSpecSchema = z.object({
  local_path: z
    .string()
    .describe(
      "Path to a file on the agent's local filesystem (typically inside the agent's workspace).",
    ),
  filename: z
    .string()
    .optional()
    .describe("Override the displayed filename. Defaults to basename of local_path."),
});

interface JiraIssueResource {
  id?: string;
  key?: string;
  self?: string;
  fields?: {
    summary?: string;
    description?: unknown;
    status?: { name?: string; statusCategory?: { name?: string } };
    issuetype?: { name?: string };
    project?: { key?: string; name?: string };
    priority?: { name?: string };
    assignee?: { accountId?: string; displayName?: string; emailAddress?: string };
    reporter?: { accountId?: string; displayName?: string; emailAddress?: string };
    created?: string;
    updated?: string;
    duedate?: string | null;
    labels?: string[];
    components?: Array<{ id?: string; name?: string }>;
    parent?: { key?: string; fields?: { summary?: string } };
    [k: string]: unknown;
  };
}

function summarizeIssue(issue: JiraIssueResource): unknown {
  const f = issue.fields ?? {};
  return {
    id: issue.id,
    key: issue.key,
    summary: f.summary,
    description: adfToText(f.description),
    status: f.status?.name,
    statusCategory: f.status?.statusCategory?.name,
    issueType: f.issuetype?.name,
    project: f.project ? { key: f.project.key, name: f.project.name } : null,
    priority: f.priority?.name,
    assignee: f.assignee
      ? {
          accountId: f.assignee.accountId,
          name: f.assignee.displayName,
          email: f.assignee.emailAddress,
        }
      : null,
    reporter: f.reporter
      ? {
          accountId: f.reporter.accountId,
          name: f.reporter.displayName,
          email: f.reporter.emailAddress,
        }
      : null,
    parent: f.parent ? { key: f.parent.key, summary: f.parent.fields?.summary } : null,
    labels: f.labels ?? [],
    components: (f.components ?? []).map((c) => c.name).filter(Boolean),
    created: f.created,
    updated: f.updated,
    dueDate: f.duedate,
  };
}

export function registerIssueTools(server: McpServer, jira: JiraApiClient): void {
  server.tool(
    "search_issues",
    "Search issues using JQL. Returns parsed issue summaries plus a `next_page_token` for cursor-based pagination. The legacy `/rest/api/3/search` endpoint was removed by Atlassian in 2025; this tool uses the replacement enhanced search at `/rest/api/3/search/jql` (no `total` field anymore — Atlassian dropped it for performance, use approximate_issue_count if you need a count). For relative dates in JQL (`created >= -7d`, `updated >= startOfWeek()`) Jira's own server-side functions handle 'now' — but if you need to construct an absolute date (e.g. `created >= \"2026-05-01\"`) and don't know today, call `exec` with `node -e \"console.log(new Date().toISOString())\"` first; do not guess.",
    {
      jql: z
        .string()
        .describe(
          "Jira Query Language string, e.g. 'project = ASC AND status = \"In Progress\" ORDER BY updated DESC'.",
        ),
      max: z.number().int().min(1).max(100).optional().describe("Default 50."),
      next_page_token: z
        .string()
        .optional()
        .describe(
          "Cursor returned by a previous call's `next_page_token`. Replaces the old `startAt` offset; the new endpoint only supports forward pagination via cursor.",
        ),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          "Subset of fields to fetch. Default: summary, status, assignee, reporter, priority, issuetype, project, labels, components, parent, duedate, description, created, updated.",
        ),
    },
    async ({ jql, max, next_page_token, fields }) =>
      handleToolCall(async () => {
        const body: Record<string, unknown> = {
          jql,
          maxResults: max ?? 50,
          fields: fields ?? [
            "summary",
            "status",
            "assignee",
            "reporter",
            "priority",
            "issuetype",
            "project",
            "labels",
            "components",
            "parent",
            "duedate",
            "description",
            "created",
            "updated",
          ],
        };
        if (next_page_token) body.nextPageToken = next_page_token;
        const r = await jira.request<{
          issues?: JiraIssueResource[];
          nextPageToken?: string;
          isLast?: boolean;
        }>(`${API}/search/jql`, {
          method: "POST",
          json: body,
        });
        return formatData({
          issues: (r.issues ?? []).map(summarizeIssue),
          next_page_token: r.nextPageToken ?? null,
          is_last: r.isLast ?? true,
        });
      }),
  );

  server.tool(
    "approximate_issue_count",
    "Return Atlassian's approximate count of issues matching a JQL query. Replaces the `total` field that the legacy search endpoint used to return — the new search endpoint doesn't compute totals for performance reasons. Use sparingly (it's a separate roundtrip).",
    {
      jql: z.string(),
    },
    async ({ jql }) =>
      handleToolCall(async () => {
        const r = await jira.request<{ count?: number }>(
          `${API}/search/approximate-count`,
          { method: "POST", json: { jql } },
        );
        return formatData({ count: r.count ?? 0, jql });
      }),
  );

  server.tool(
    "get_issue",
    "Fetch a single Jira issue by key (e.g. 'ASC-1234') or id.",
    {
      issue_key: z.string(),
      fields: z.array(z.string()).optional(),
      include_changelog: z.boolean().optional(),
    },
    async ({ issue_key, fields, include_changelog }) =>
      handleToolCall(async () => {
        const issue = await jira.request<JiraIssueResource>(
          `${API}/issue/${encodeURIComponent(issue_key)}`,
          {
            query: {
              fields: fields ? fields.join(",") : "*all",
              expand: include_changelog ? "changelog" : undefined,
            },
          },
        );
        return formatData(summarizeIssue(issue));
      }),
  );

  server.tool(
    "create_issue",
    "Create a new Jira issue. Required: project_key, summary, issue_type. Description is optional plain text (auto-converted to ADF). Optional `attachments` are uploaded to the new issue immediately after creation.",
    {
      project_key: z.string().describe("Project key, e.g. 'PROJ'."),
      issue_type: z
        .string()
        .describe("Issue type name, e.g. 'Task', 'Bug', 'Story', 'Epic'."),
      summary: z.string(),
      description: z.string().optional(),
      assignee_account_id: z
        .string()
        .optional()
        .describe("Atlassian accountId. Use lookup_user_by_email if you only have the email."),
      labels: z.array(z.string()).optional(),
      priority_name: z.string().optional(),
      parent_key: z
        .string()
        .optional()
        .describe("Parent issue key (e.g. 'ASC-99' for subtask, or epic key for stories under that epic)."),
      due_date: z.string().optional().describe("ISO date 'YYYY-MM-DD'."),
      attachments: z
        .array(attachmentSpecSchema)
        .optional()
        .describe(
          "Files to attach to the new issue. Uploaded in a follow-up multipart request after the issue is created. Each spec is { local_path, filename? }.",
        ),
    },
    async (args) =>
      handleToolCall(async () => {
        const fields: Record<string, unknown> = {
          project: { key: args.project_key },
          issuetype: { name: args.issue_type },
          summary: args.summary,
        };
        if (args.description) fields.description = textToAdf(args.description);
        if (args.assignee_account_id)
          fields.assignee = { accountId: args.assignee_account_id };
        if (args.labels?.length) fields.labels = args.labels;
        if (args.priority_name) fields.priority = { name: args.priority_name };
        if (args.parent_key) fields.parent = { key: args.parent_key };
        if (args.due_date) fields.duedate = args.due_date;
        const r = await jira.request<{ id?: string; key?: string }>(
          `${API}/issue`,
          { method: "POST", json: { fields } },
        );
        let attached: unknown[] = [];
        if (args.attachments?.length && r.key) {
          attached = await uploadAttachments(
            jira,
            r.key,
            args.attachments.map((a) => ({
              localPath: a.local_path,
              filename: a.filename,
            })),
          );
        }
        return formatSuccess(`issue created: ${r.key}`, {
          ...r,
          attachments: attached,
        });
      }),
  );

  server.tool(
    "update_issue",
    "Update fields on an existing issue. Pass only the fields to change. Use null on `assignee_account_id` to unassign. Optional `attachments` are uploaded to the issue after the field update.",
    {
      issue_key: z.string(),
      summary: z.string().optional(),
      description: z.string().optional(),
      assignee_account_id: z
        .string()
        .nullable()
        .optional()
        .describe("Set to null to unassign."),
      labels: z.array(z.string()).optional(),
      priority_name: z.string().optional(),
      due_date: z.string().nullable().optional(),
      attachments: z
        .array(attachmentSpecSchema)
        .optional()
        .describe(
          "Files to attach to the issue. Each is { local_path, filename? }. At least one of the field args OR attachments must be supplied.",
        ),
    },
    async (args) =>
      handleToolCall(async () => {
        const fields: Record<string, unknown> = {};
        if (args.summary !== undefined) fields.summary = args.summary;
        if (args.description !== undefined)
          fields.description = textToAdf(args.description);
        if (args.assignee_account_id !== undefined) {
          fields.assignee = args.assignee_account_id
            ? { accountId: args.assignee_account_id }
            : null;
        }
        if (args.labels !== undefined) fields.labels = args.labels;
        if (args.priority_name !== undefined)
          fields.priority = { name: args.priority_name };
        if (args.due_date !== undefined) fields.duedate = args.due_date;
        const hasFields = Object.keys(fields).length > 0;
        if (!hasFields && !args.attachments?.length) {
          throw new Error(
            "update_issue: at least one field OR attachments must be supplied",
          );
        }
        if (hasFields) {
          await jira.request(
            `${API}/issue/${encodeURIComponent(args.issue_key)}`,
            { method: "PUT", json: { fields } },
          );
        }
        let attached: unknown[] = [];
        if (args.attachments?.length) {
          attached = await uploadAttachments(
            jira,
            args.issue_key,
            args.attachments.map((a) => ({
              localPath: a.local_path,
              filename: a.filename,
            })),
          );
        }
        return formatSuccess(
          attached.length
            ? `updated ${args.issue_key} + attached ${attached.length} file(s)`
            : `updated ${args.issue_key}`,
          attached.length ? { attachments: attached } : undefined,
        );
      }),
  );

  server.tool(
    "list_transitions",
    "List the workflow transitions available on an issue from its current status (e.g. 'In Progress' → 'Done').",
    {
      issue_key: z.string(),
    },
    async ({ issue_key }) =>
      handleToolCall(async () => {
        const r = await jira.request<{
          transitions?: Array<{
            id?: string;
            name?: string;
            to?: { name?: string; statusCategory?: { name?: string } };
          }>;
        }>(`${API}/issue/${encodeURIComponent(issue_key)}/transitions`);
        return formatData(
          (r.transitions ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            toStatus: t.to?.name,
            toCategory: t.to?.statusCategory?.name,
          })),
        );
      }),
  );

  server.tool(
    "transition_issue",
    "Move an issue through a workflow transition (e.g. accept, reject, close). Use list_transitions to find the transition_id valid from the current state.",
    {
      issue_key: z.string(),
      transition_id: z.string(),
      comment: z
        .string()
        .optional()
        .describe("Plain-text comment to add as part of the transition."),
    },
    async ({ issue_key, transition_id, comment }) =>
      handleToolCall(async () => {
        const body: Record<string, unknown> = {
          transition: { id: transition_id },
        };
        if (comment) {
          body.update = {
            comment: [{ add: { body: textToAdf(comment) } }],
          };
        }
        await jira.request(
          `${API}/issue/${encodeURIComponent(issue_key)}/transitions`,
          { method: "POST", json: body },
        );
        return formatSuccess(
          `transitioned ${issue_key} via transition ${transition_id}`,
        );
      }),
  );

  server.tool(
    "add_comment",
    "Add a plain-text comment to an issue. Text is converted to Atlassian Document Format. Optional `attachments` get uploaded to the issue (Jira stores attachments at issue level, not on individual comments — reference them in the comment body if you want).",
    {
      issue_key: z.string(),
      body: z.string(),
      attachments: z.array(attachmentSpecSchema).optional(),
    },
    async ({ issue_key, body, attachments }) =>
      handleToolCall(async () => {
        const r = await jira.request<{ id?: string }>(
          `${API}/issue/${encodeURIComponent(issue_key)}/comment`,
          { method: "POST", json: { body: textToAdf(body) } },
        );
        let attached: unknown[] = [];
        if (attachments?.length) {
          attached = await uploadAttachments(
            jira,
            issue_key,
            attachments.map((a) => ({
              localPath: a.local_path,
              filename: a.filename,
            })),
          );
        }
        return formatSuccess(
          attached.length
            ? `comment added to ${issue_key} + ${attached.length} attachment(s)`
            : `comment added to ${issue_key}`,
          { comment: r, attachments: attached },
        );
      }),
  );

  server.tool(
    "list_comments",
    "List comments on an issue. Returns parsed plain-text bodies + author + timestamps.",
    {
      issue_key: z.string(),
      max: z.number().int().min(1).max(100).optional(),
    },
    async ({ issue_key, max }) =>
      handleToolCall(async () => {
        const r = await jira.request<{
          comments?: Array<{
            id?: string;
            author?: { displayName?: string; emailAddress?: string };
            body?: unknown;
            created?: string;
            updated?: string;
          }>;
        }>(`${API}/issue/${encodeURIComponent(issue_key)}/comment`, {
          query: { maxResults: max ?? 50 },
        });
        return formatData(
          (r.comments ?? []).map((c) => ({
            id: c.id,
            author: c.author?.displayName,
            authorEmail: c.author?.emailAddress,
            body: adfToText(c.body),
            created: c.created,
            updated: c.updated,
          })),
        );
      }),
  );

  server.tool(
    "assign_issue",
    "Assign an issue to a user (or unassign with null).",
    {
      issue_key: z.string(),
      account_id: z
        .string()
        .nullable()
        .describe(
          "Atlassian accountId, or null to unassign. Use lookup_user_by_email to resolve a user to an accountId.",
        ),
    },
    async ({ issue_key, account_id }) =>
      handleToolCall(async () => {
        await jira.request(
          `${API}/issue/${encodeURIComponent(issue_key)}/assignee`,
          { method: "PUT", json: { accountId: account_id } },
        );
        return formatSuccess(
          account_id
            ? `assigned ${issue_key} to ${account_id}`
            : `unassigned ${issue_key}`,
        );
      }),
  );

  server.tool(
    "add_worklog",
    "Log time spent on an issue (e.g. '30m', '2h 15m', '1d').",
    {
      issue_key: z.string(),
      time_spent: z
        .string()
        .describe("e.g. '30m', '2h', '1d 4h'. Atlassian's duration format."),
      comment: z.string().optional(),
      started_iso: z
        .string()
        .optional()
        .describe(
          "ISO-8601 start time. Default: now. Atlassian wants the timezone-aware form (e.g. '2026-05-07T09:30:00.000-0400').",
        ),
    },
    async ({ issue_key, time_spent, comment, started_iso }) =>
      handleToolCall(async () => {
        const body: Record<string, unknown> = { timeSpent: time_spent };
        if (comment) body.comment = textToAdf(comment);
        if (started_iso) body.started = started_iso;
        const r = await jira.request<{ id?: string }>(
          `${API}/issue/${encodeURIComponent(issue_key)}/worklog`,
          { method: "POST", json: body },
        );
        return formatSuccess(`worklog logged on ${issue_key}`, r);
      }),
  );

  server.tool(
    "list_issue_links",
    "List inward + outward issue links (e.g. 'blocks', 'is blocked by', 'relates to') on an issue.",
    { issue_key: z.string() },
    async ({ issue_key }) =>
      handleToolCall(async () => {
        const issue = await jira.request<{
          fields?: { issuelinks?: unknown[] };
        }>(`${API}/issue/${encodeURIComponent(issue_key)}`, {
          query: { fields: "issuelinks" },
        });
        return formatData(issue.fields?.issuelinks ?? []);
      }),
  );

  server.tool(
    "create_issue_link",
    "Create a directional link between two issues (e.g. 'blocks', 'relates to'). Use list_link_types to see valid link names.",
    {
      type_name: z.string().describe("Link type name (e.g. 'Blocks', 'Relates')."),
      inward_issue_key: z
        .string()
        .describe("The 'from' side (e.g. for Blocks: this issue blocks the outward one)."),
      outward_issue_key: z.string(),
      comment: z.string().optional(),
    },
    async ({ type_name, inward_issue_key, outward_issue_key, comment }) =>
      handleToolCall(async () => {
        const body: Record<string, unknown> = {
          type: { name: type_name },
          inwardIssue: { key: inward_issue_key },
          outwardIssue: { key: outward_issue_key },
        };
        if (comment) body.comment = { body: textToAdf(comment) };
        await jira.request(`${API}/issueLink`, {
          method: "POST",
          json: body,
        });
        return formatSuccess(
          `linked ${inward_issue_key} → ${outward_issue_key} (${type_name})`,
        );
      }),
  );

  server.tool(
    "list_link_types",
    "List all valid issue-link type names available on this Jira instance.",
    {},
    async () =>
      handleToolCall(async () => {
        const r = await jira.request<{
          issueLinkTypes?: Array<{
            id?: string;
            name?: string;
            inward?: string;
            outward?: string;
          }>;
        }>(`${API}/issueLinkType`);
        return formatData(r.issueLinkTypes ?? []);
      }),
  );
}
