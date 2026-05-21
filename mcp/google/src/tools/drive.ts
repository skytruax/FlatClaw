import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import type { GoogleApiClient } from "../google-client.js";
import { handleToolCall, formatData, formatSuccess } from "../tool-helpers.js";

const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

const FILE_FIELDS =
  "id,name,mimeType,parents,modifiedTime,createdTime,size,webViewLink,trashed,owners(emailAddress,displayName)";

export function registerDriveTools(server: McpServer, api: GoogleApiClient): void {
  server.tool(
    "drive_ls",
    "List files in a Drive folder (default: root). Returns id/name/mimeType/modifiedTime per file. Pass `q` to filter (Drive query language).",
    {
      folder_id: z
        .string()
        .optional()
        .describe("Folder id. Omit for the user's root."),
      q: z.string().optional().describe("Drive query (e.g. 'mimeType contains \"image\"')."),
      max: z.number().int().min(1).max(1000).optional(),
      include_trashed: z.boolean().optional(),
      order_by: z
        .string()
        .optional()
        .describe("e.g. 'modifiedTime desc' or 'name'."),
    },
    async ({ folder_id, q, max, include_trashed, order_by }) =>
      handleToolCall(async () => {
        const parts: string[] = [];
        const parent = folder_id ?? "root";
        parts.push(`'${parent}' in parents`);
        if (!include_trashed) parts.push("trashed = false");
        if (q) parts.push(`(${q})`);
        const result = await api.request<{ files?: unknown[] }>(`${DRIVE}/files`, {
          query: {
            q: parts.join(" and "),
            pageSize: max ?? 100,
            fields: `files(${FILE_FIELDS})`,
            orderBy: order_by,
          },
        });
        return formatData(result.files ?? []);
      }),
  );

  server.tool(
    "drive_search",
    "Full-text search across the user's Drive (Drive's `q` operator with `fullText contains`).",
    {
      query: z.string().describe("Free-text query."),
      max: z.number().int().min(1).max(1000).optional(),
      mime_type: z.string().optional().describe("Filter by mimeType (e.g. 'application/pdf')."),
    },
    async ({ query, max, mime_type }) =>
      handleToolCall(async () => {
        const parts = [`fullText contains '${query.replace(/'/g, "\\'")}'`, "trashed = false"];
        if (mime_type) parts.push(`mimeType = '${mime_type.replace(/'/g, "\\'")}'`);
        const result = await api.request<{ files?: unknown[] }>(`${DRIVE}/files`, {
          query: {
            q: parts.join(" and "),
            pageSize: max ?? 50,
            fields: `files(${FILE_FIELDS})`,
          },
        });
        return formatData(result.files ?? []);
      }),
  );

  server.tool(
    "drive_get",
    "Get metadata for a single Drive file.",
    {
      file_id: z.string(),
    },
    async ({ file_id }) =>
      handleToolCall(async () => {
        const r = await api.request(`${DRIVE}/files/${encodeURIComponent(file_id)}`, {
          query: { fields: FILE_FIELDS },
        });
        return formatData(r);
      }),
  );

  server.tool(
    "drive_upload",
    "Upload a file from the agent's local filesystem to Drive (multipart upload). Returns the new file's id + metadata.",
    {
      local_path: z.string(),
      name: z.string().optional().describe("Override the destination filename."),
      parent_folder_id: z.string().optional(),
      mime_type: z.string().optional(),
    },
    async ({ local_path, name, parent_folder_id, mime_type }) =>
      handleToolCall(async () => {
        const buf = await fs.promises.readFile(local_path);
        const filename = name ?? path.basename(local_path);
        const contentType = mime_type ?? "application/octet-stream";
        const metadata: Record<string, unknown> = { name: filename };
        if (parent_folder_id) metadata.parents = [parent_folder_id];
        const boundary = `bnd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
        const meta = JSON.stringify(metadata);
        const head = Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
          "utf8",
        );
        const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
        const body = Buffer.concat([head, buf, tail]);
        const result = await api.request(`${DRIVE_UPLOAD}/files`, {
          method: "POST",
          query: { uploadType: "multipart", fields: FILE_FIELDS },
          body,
          headers: {
            "Content-Type": `multipart/related; boundary=${boundary}`,
            "Content-Length": String(body.length),
          },
        });
        return formatSuccess(`uploaded ${filename}`, result);
      }),
  );

  server.tool(
    "drive_download",
    "Download a Drive file to a local path. For Google-native formats (Docs/Sheets/Slides), pass `export_mime` to control export type.",
    {
      file_id: z.string(),
      out_path: z.string(),
      export_mime: z
        .string()
        .optional()
        .describe(
          "Export MIME for Google-native files, e.g. 'application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'.",
        ),
    },
    async ({ file_id, out_path, export_mime }) =>
      handleToolCall(async () => {
        const url = export_mime
          ? `${DRIVE}/files/${encodeURIComponent(file_id)}/export`
          : `${DRIVE}/files/${encodeURIComponent(file_id)}`;
        const buf = await api.request<Buffer>(url, {
          query: export_mime ? { mimeType: export_mime } : { alt: "media" },
          binary: true,
        });
        await fs.promises.writeFile(out_path, buf);
        return formatSuccess(`downloaded to ${out_path}`, {
          bytes: buf.length,
        });
      }),
  );

  server.tool(
    "drive_share",
    "Share a Drive file or folder with another user. role: reader|commenter|writer|fileOrganizer|organizer.",
    {
      file_id: z.string(),
      email: z.string(),
      role: z.enum(["reader", "commenter", "writer", "fileOrganizer", "organizer"]),
      type: z.enum(["user", "group", "domain", "anyone"]).optional(),
      send_notification: z.boolean().optional(),
      message: z.string().optional(),
    },
    async ({ file_id, email, role, type, send_notification, message }) =>
      handleToolCall(async () => {
        const result = await api.request(
          `${DRIVE}/files/${encodeURIComponent(file_id)}/permissions`,
          {
            method: "POST",
            query: {
              sendNotificationEmail: send_notification ?? true,
              emailMessage: message,
              fields: "id,role,type,emailAddress",
            },
            json: { role, type: type ?? "user", emailAddress: email },
          },
        );
        return formatSuccess(`shared ${file_id} with ${email} as ${role}`, result);
      }),
  );

  server.tool(
    "drive_unshare",
    "Remove a permission from a Drive file or folder.",
    {
      file_id: z.string(),
      permission_id: z.string(),
    },
    async ({ file_id, permission_id }) =>
      handleToolCall(async () => {
        await api.request(
          `${DRIVE}/files/${encodeURIComponent(file_id)}/permissions/${encodeURIComponent(permission_id)}`,
          { method: "DELETE" },
        );
        return formatSuccess(`permission ${permission_id} removed`);
      }),
  );

  server.tool(
    "drive_mkdir",
    "Create a Drive folder.",
    {
      name: z.string(),
      parent_folder_id: z.string().optional(),
    },
    async ({ name, parent_folder_id }) =>
      handleToolCall(async () => {
        const result = await api.request(`${DRIVE}/files`, {
          method: "POST",
          query: { fields: FILE_FIELDS },
          json: {
            name,
            mimeType: "application/vnd.google-apps.folder",
            ...(parent_folder_id ? { parents: [parent_folder_id] } : {}),
          },
        });
        return formatSuccess(`folder created: ${name}`, result);
      }),
  );

  server.tool(
    "drive_move",
    "Move a Drive file/folder to a different parent folder.",
    {
      file_id: z.string(),
      new_parent_id: z.string(),
    },
    async ({ file_id, new_parent_id }) =>
      handleToolCall(async () => {
        const cur = await api.request<{ parents?: string[] }>(
          `${DRIVE}/files/${encodeURIComponent(file_id)}`,
          { query: { fields: "parents" } },
        );
        const result = await api.request(
          `${DRIVE}/files/${encodeURIComponent(file_id)}`,
          {
            method: "PATCH",
            query: {
              addParents: new_parent_id,
              removeParents: (cur.parents ?? []).join(","),
              fields: FILE_FIELDS,
            },
          },
        );
        return formatSuccess(`moved ${file_id}`, result);
      }),
  );

  server.tool(
    "drive_copy",
    "Copy a Drive file. Optionally rename and re-parent.",
    {
      file_id: z.string(),
      name: z.string().optional(),
      parent_folder_id: z.string().optional(),
    },
    async ({ file_id, name, parent_folder_id }) =>
      handleToolCall(async () => {
        const json: Record<string, unknown> = {};
        if (name) json.name = name;
        if (parent_folder_id) json.parents = [parent_folder_id];
        const result = await api.request(
          `${DRIVE}/files/${encodeURIComponent(file_id)}/copy`,
          { method: "POST", query: { fields: FILE_FIELDS }, json },
        );
        return formatSuccess(`copied ${file_id}`, result);
      }),
  );

  server.tool(
    "drive_rename",
    "Rename a Drive file or folder.",
    {
      file_id: z.string(),
      name: z.string(),
    },
    async ({ file_id, name }) =>
      handleToolCall(async () => {
        const result = await api.request(
          `${DRIVE}/files/${encodeURIComponent(file_id)}`,
          { method: "PATCH", query: { fields: FILE_FIELDS }, json: { name } },
        );
        return formatSuccess(`renamed ${file_id} → ${name}`, result);
      }),
  );

  server.tool(
    "drive_trash",
    "Move a Drive file to trash (recoverable for ~30 days).",
    { file_id: z.string() },
    async ({ file_id }) =>
      handleToolCall(async () => {
        const result = await api.request(
          `${DRIVE}/files/${encodeURIComponent(file_id)}`,
          {
            method: "PATCH",
            query: { fields: FILE_FIELDS },
            json: { trashed: true },
          },
        );
        return formatSuccess(`trashed ${file_id}`, result);
      }),
  );

  server.tool(
    "drive_delete",
    "PERMANENTLY delete a Drive file (bypasses trash). Use drive_trash for soft-delete.",
    { file_id: z.string() },
    async ({ file_id }) =>
      handleToolCall(async () => {
        await api.request(`${DRIVE}/files/${encodeURIComponent(file_id)}`, {
          method: "DELETE",
        });
        return formatSuccess(`permanently deleted ${file_id}`);
      }),
  );
}
