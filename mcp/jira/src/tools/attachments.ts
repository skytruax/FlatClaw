import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import type { JiraApiClient } from "../jira-client.js";
import { handleToolCall, formatData, formatSuccess } from "../tool-helpers.js";

const API = "/rest/api/3";

interface JiraAttachment {
  id?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  created?: string;
  author?: { accountId?: string; displayName?: string; emailAddress?: string };
  content?: string; // signed download URL
  thumbnail?: string;
}

function summarize(att: JiraAttachment): unknown {
  return {
    id: att.id,
    filename: att.filename,
    mimeType: att.mimeType,
    size: att.size,
    created: att.created,
    author: att.author?.displayName,
    authorEmail: att.author?.emailAddress,
  };
}

export interface AttachmentSpec {
  localPath: string;
  filename?: string;
}

/**
 * Multipart-upload one or more local files as attachments on an existing
 * Jira issue. Shared by `attach_file_to_issue` and by the
 * `create_issue` / `update_issue` `attachments` argument fan-outs.
 *
 * Atlassian requires the `X-Atlassian-Token: no-check` header on file
 * uploads (bypasses XSRF protection); request fails silently without it.
 */
export async function uploadAttachments(
  jira: JiraApiClient,
  issueKey: string,
  specs: AttachmentSpec[],
): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const spec of specs) {
    const buf = await fs.promises.readFile(spec.localPath);
    const name = spec.filename ?? path.basename(spec.localPath);
    const boundary = `bnd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${name}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
      "utf8",
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
    const body = Buffer.concat([head, buf, tail]);
    const r = await jira.request<JiraAttachment[]>(
      `${API}/issue/${encodeURIComponent(issueKey)}/attachments`,
      {
        method: "POST",
        body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "X-Atlassian-Token": "no-check",
        },
      },
    );
    out.push(...(r ?? []).map(summarize));
  }
  return out;
}

export function registerAttachmentTools(server: McpServer, jira: JiraApiClient): void {
  server.tool(
    "list_issue_attachments",
    "List the attachments on a Jira issue. Returns id / filename / mimeType / size / author / created per attachment. Use the id with download_attachment.",
    {
      issue_key: z.string(),
    },
    async ({ issue_key }) =>
      handleToolCall(async () => {
        const issue = await jira.request<{
          fields?: { attachment?: JiraAttachment[] };
        }>(`${API}/issue/${encodeURIComponent(issue_key)}`, {
          query: { fields: "attachment" },
        });
        const list = issue.fields?.attachment ?? [];
        return formatData({
          issue_key,
          count: list.length,
          attachments: list.map(summarize),
        });
      }),
  );

  server.tool(
    "get_attachment_metadata",
    "Fetch metadata for a single attachment by id (filename / mimeType / size / author / signed-download URL).",
    {
      attachment_id: z.string(),
    },
    async ({ attachment_id }) =>
      handleToolCall(async () => {
        const att = await jira.request<JiraAttachment>(
          `${API}/attachment/${encodeURIComponent(attachment_id)}`,
        );
        return formatData(att);
      }),
  );

  server.tool(
    "download_attachment",
    "Download an attachment's binary content. Either save it to a path the agent can read (out_path) and return metadata, or — when no out_path is given — return base64 content directly. Defaults to writing the file with its original filename into the agent's workspace.",
    {
      attachment_id: z.string(),
      out_path: z
        .string()
        .optional()
        .describe(
          "Local path to write the file to. Defaults to ~/.openclaw/workspace-<agent>/<filename>. Set explicitly if you want a different name or directory.",
        ),
      max_bytes: z
        .number()
        .int()
        .min(1)
        .max(50 * 1024 * 1024)
        .optional()
        .describe(
          "Cap on response size when returning base64 (no out_path). Default 5 MiB. Files larger than this should always go to out_path.",
        ),
    },
    async ({ attachment_id, out_path, max_bytes }) =>
      handleToolCall(async () => {
        // First a metadata fetch to get filename + size; cheap and lets us
        // pick a sensible default out_path + bail early on huge files.
        const meta = await jira.request<JiraAttachment>(
          `${API}/attachment/${encodeURIComponent(attachment_id)}`,
        );
        const filename = meta.filename ?? `attachment-${attachment_id}`;
        const declaredSize = meta.size ?? 0;

        // Default out_path: agent workspace if we can find one, else cwd.
        const defaultDir =
          process.env.OPENCLAW_WORKSPACE_PATH ?? process.cwd();
        const effectiveOut =
          out_path ?? path.join(defaultDir, filename);

        // Fetch the bytes. /rest/api/3/attachment/content/{id} 302s to a
        // signed CDN URL; the client follows.
        const buf = await jira.request<Buffer>(
          `${API}/attachment/content/${encodeURIComponent(attachment_id)}`,
          { binary: true },
        );

        // If the caller didn't ask for a base64 inline (no out_path
        // override AND we have a sane default), write to disk.
        if (out_path !== "-") {
          await fs.promises.mkdir(path.dirname(effectiveOut), {
            recursive: true,
          });
          await fs.promises.writeFile(effectiveOut, buf);
          return formatSuccess(
            `downloaded ${filename} (${buf.length} bytes) → ${effectiveOut}`,
            {
              id: attachment_id,
              filename,
              mimeType: meta.mimeType,
              size: buf.length,
              declaredSize,
              path: effectiveOut,
            },
          );
        }

        // Inline base64 mode (caller passed out_path === "-").
        const cap = max_bytes ?? 5 * 1024 * 1024;
        const truncated = buf.length > cap ? buf.subarray(0, cap) : buf;
        return formatData({
          id: attachment_id,
          filename,
          mimeType: meta.mimeType,
          size: truncated.length,
          declaredSize,
          truncated: truncated.length < buf.length,
          base64: truncated.toString("base64"),
        });
      }),
  );

  server.tool(
    "attach_file_to_issue",
    "Upload a local file as a new attachment on an existing issue. The path must be readable by the MCP process (typically inside the agent's workspace). To attach files at issue-create time, use create_issue with its `attachments` argument instead — saves a roundtrip.",
    {
      issue_key: z.string(),
      local_path: z.string(),
      filename: z
        .string()
        .optional()
        .describe("Override the displayed filename. Defaults to the basename of local_path."),
    },
    async ({ issue_key, local_path, filename }) =>
      handleToolCall(async () => {
        const result = await uploadAttachments(jira, issue_key, [
          { localPath: local_path, filename },
        ]);
        return formatSuccess(
          `attached ${result.length} file(s) to ${issue_key}`,
          result,
        );
      }),
  );

  server.tool(
    "delete_attachment",
    "Delete an attachment from Jira by id. Caller needs delete-attachment permission on the project.",
    {
      attachment_id: z.string(),
    },
    async ({ attachment_id }) =>
      handleToolCall(async () => {
        await jira.request(
          `${API}/attachment/${encodeURIComponent(attachment_id)}`,
          { method: "DELETE" },
        );
        return formatSuccess(`deleted attachment ${attachment_id}`);
      }),
  );
}
