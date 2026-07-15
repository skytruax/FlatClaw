import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GoogleApiClient } from "../google-client.js";
import { handleToolCall, formatData, formatSuccess } from "../tool-helpers.js";

const DOCS = "https://docs.googleapis.com/v1";
const DRIVE = "https://www.googleapis.com/drive/v3";

interface DocsParagraphElement {
  textRun?: { content?: string };
}
interface DocsParagraph {
  elements?: DocsParagraphElement[];
}
interface DocsStructuralElement {
  paragraph?: DocsParagraph;
}
interface DocsBody {
  content?: DocsStructuralElement[];
}
interface DocsResource {
  documentId?: string;
  title?: string;
  body?: DocsBody;
}

function flattenDocText(doc: DocsResource): string {
  const out: string[] = [];
  for (const el of doc.body?.content ?? []) {
    for (const inner of el.paragraph?.elements ?? []) {
      const t = inner.textRun?.content;
      if (t) out.push(t);
    }
  }
  return out.join("");
}

export function registerDocsTools(server: McpServer, api: GoogleApiClient): void {
  server.tool(
    "docs_get",
    "Get a Google Doc as plain text + the underlying API JSON. Use docs_get_raw if you need the structural API response only.",
    {
      doc_id: z.string(),
    },
    async ({ doc_id }) =>
      handleToolCall(async () => {
        const r = await api.request<DocsResource>(
          `${DOCS}/documents/${encodeURIComponent(doc_id)}`,
        );
        return formatData({
          documentId: r.documentId,
          title: r.title,
          text: flattenDocText(r),
        });
      }),
  );

  server.tool(
    "docs_get_raw",
    "Get a Google Doc's full structural API response (paragraphs, runs, lists, tables, named ranges).",
    {
      doc_id: z.string(),
    },
    async ({ doc_id }) =>
      handleToolCall(async () => {
        const r = await api.request(
          `${DOCS}/documents/${encodeURIComponent(doc_id)}`,
        );
        return formatData(r);
      }),
  );

  server.tool(
    "docs_create",
    "Create a new Google Doc. Optionally drop initial content via the body parameter; otherwise the doc is empty.",
    {
      title: z.string(),
      body: z.string().optional(),
      parent_folder_id: z
        .string()
        .optional()
        .describe(
          "If supplied, move the new doc into this Drive folder after creation (Docs API can't set parents at create-time).",
        ),
    },
    async ({ title, body, parent_folder_id }) =>
      handleToolCall(async () => {
        const created = await api.request<DocsResource>(`${DOCS}/documents`, {
          method: "POST",
          json: { title },
        });
        const docId = created.documentId!;
        if (body) {
          await api.request(`${DOCS}/documents/${docId}:batchUpdate`, {
            method: "POST",
            json: {
              requests: [
                {
                  insertText: { location: { index: 1 }, text: body },
                },
              ],
            },
          });
        }
        if (parent_folder_id) {
          await api.request(`${DRIVE}/files/${docId}`, {
            method: "PATCH",
            query: { addParents: parent_folder_id },
          });
        }
        return formatSuccess(`doc created: ${title}`, {
          documentId: docId,
          url: `https://docs.google.com/document/d/${docId}/edit`,
        });
      }),
  );

  server.tool(
    "docs_append",
    "Append text to the end of a Google Doc.",
    {
      doc_id: z.string(),
      text: z.string(),
    },
    async ({ doc_id, text }) =>
      handleToolCall(async () => {
        await api.request(`${DOCS}/documents/${encodeURIComponent(doc_id)}:batchUpdate`, {
          method: "POST",
          json: {
            requests: [{ insertText: { endOfSegmentLocation: {}, text } }],
          },
        });
        return formatSuccess(`appended ${text.length} chars to ${doc_id}`);
      }),
  );

  server.tool(
    "docs_replace_all",
    "Find and replace all occurrences of `find` with `replace` across the doc body.",
    {
      doc_id: z.string(),
      find: z.string(),
      replace: z.string(),
      match_case: z.boolean().optional(),
    },
    async ({ doc_id, find, replace, match_case }) =>
      handleToolCall(async () => {
        const result = await api.request(
          `${DOCS}/documents/${encodeURIComponent(doc_id)}:batchUpdate`,
          {
            method: "POST",
            json: {
              requests: [
                {
                  replaceAllText: {
                    containsText: { text: find, matchCase: match_case ?? false },
                    replaceText: replace,
                  },
                },
              ],
            },
          },
        );
        return formatSuccess(`replaced occurrences of "${find}"`, result);
      }),
  );

  server.tool(
    "docs_batch_update",
    "Run an arbitrary batchUpdate request payload against a Doc. Use this for advanced operations: inserting at specific indices, deleting ranges, applying paragraph styles, creating named ranges, inserting tables/images, etc. The argument MUST be a valid `requests` array per the Google Docs API.",
    {
      doc_id: z.string(),
      requests: z
        .array(z.record(z.string(), z.unknown()))
        .min(1)
        .describe(
          "Array of Docs API request objects (e.g. [{insertText:{location:{index:1}, text:'…'}}, {deleteContentRange:{range:{startIndex:1, endIndex:5}}}]).",
        ),
    },
    async ({ doc_id, requests }) =>
      handleToolCall(async () => {
        const result = await api.request(
          `${DOCS}/documents/${encodeURIComponent(doc_id)}:batchUpdate`,
          { method: "POST", json: { requests } },
        );
        return formatSuccess(
          `batchUpdate applied (${requests.length} request(s))`,
          result,
        );
      }),
  );
}
