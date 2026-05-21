import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GoogleApiClient } from "../google-client.js";
import { handleToolCall, formatData, formatSuccess } from "../tool-helpers.js";

const SHEETS = "https://sheets.googleapis.com/v4";
const DRIVE = "https://www.googleapis.com/drive/v3";

export function registerSheetsTools(server: McpServer, api: GoogleApiClient): void {
  server.tool(
    "sheets_get_metadata",
    "Get a spreadsheet's metadata: title, sheets (tabs), named ranges. Excludes cell values — use sheets_read for those.",
    {
      spreadsheet_id: z.string(),
    },
    async ({ spreadsheet_id }) =>
      handleToolCall(async () => {
        const r = await api.request(
          `${SHEETS}/spreadsheets/${encodeURIComponent(spreadsheet_id)}`,
          { query: { includeGridData: false } },
        );
        return formatData(r);
      }),
  );

  server.tool(
    "sheets_read",
    "Read a range from a sheet. Range uses A1 notation (e.g. 'Sheet1!A1:C100' or 'NamedRange'). Returns rows of cell values.",
    {
      spreadsheet_id: z.string(),
      range: z.string(),
      dimension: z.enum(["ROWS", "COLUMNS"]).optional(),
      value_render: z
        .enum(["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"])
        .optional(),
    },
    async ({ spreadsheet_id, range, dimension, value_render }) =>
      handleToolCall(async () => {
        const r = await api.request(
          `${SHEETS}/spreadsheets/${encodeURIComponent(spreadsheet_id)}/values/${encodeURIComponent(range)}`,
          {
            query: {
              majorDimension: dimension,
              valueRenderOption: value_render,
            },
          },
        );
        return formatData(r);
      }),
  );

  server.tool(
    "sheets_append",
    "Append rows to the bottom of a sheet range. `values` is a 2D array; each inner array is one row.",
    {
      spreadsheet_id: z.string(),
      range: z.string(),
      values: z
        .array(z.array(z.union([z.string(), z.number(), z.boolean()])))
        .min(1),
      input_option: z.enum(["RAW", "USER_ENTERED"]).optional(),
      insert_option: z.enum(["OVERWRITE", "INSERT_ROWS"]).optional(),
    },
    async ({ spreadsheet_id, range, values, input_option, insert_option }) =>
      handleToolCall(async () => {
        const r = await api.request(
          `${SHEETS}/spreadsheets/${encodeURIComponent(spreadsheet_id)}/values/${encodeURIComponent(range)}:append`,
          {
            method: "POST",
            query: {
              valueInputOption: input_option ?? "USER_ENTERED",
              insertDataOption: insert_option ?? "INSERT_ROWS",
            },
            json: { values },
          },
        );
        return formatSuccess(`appended ${values.length} row(s) to ${range}`, r);
      }),
  );

  server.tool(
    "sheets_update",
    "Write values to a specific range, overwriting whatever's there. `values` is a 2D array.",
    {
      spreadsheet_id: z.string(),
      range: z.string(),
      values: z.array(z.array(z.union([z.string(), z.number(), z.boolean()]))),
      input_option: z.enum(["RAW", "USER_ENTERED"]).optional(),
    },
    async ({ spreadsheet_id, range, values, input_option }) =>
      handleToolCall(async () => {
        const r = await api.request(
          `${SHEETS}/spreadsheets/${encodeURIComponent(spreadsheet_id)}/values/${encodeURIComponent(range)}`,
          {
            method: "PUT",
            query: { valueInputOption: input_option ?? "USER_ENTERED" },
            json: { values },
          },
        );
        return formatSuccess(`updated ${range}`, r);
      }),
  );

  server.tool(
    "sheets_clear",
    "Clear values from a range (cell formatting preserved).",
    {
      spreadsheet_id: z.string(),
      range: z.string(),
    },
    async ({ spreadsheet_id, range }) =>
      handleToolCall(async () => {
        const r = await api.request(
          `${SHEETS}/spreadsheets/${encodeURIComponent(spreadsheet_id)}/values/${encodeURIComponent(range)}:clear`,
          { method: "POST", json: {} },
        );
        return formatSuccess(`cleared ${range}`, r);
      }),
  );

  server.tool(
    "sheets_create",
    "Create a new spreadsheet. Optionally drop it into a Drive folder.",
    {
      title: z.string(),
      parent_folder_id: z.string().optional(),
    },
    async ({ title, parent_folder_id }) =>
      handleToolCall(async () => {
        const created = await api.request<{ spreadsheetId?: string }>(
          `${SHEETS}/spreadsheets`,
          { method: "POST", json: { properties: { title } } },
        );
        const id = created.spreadsheetId!;
        if (parent_folder_id) {
          await api.request(`${DRIVE}/files/${id}`, {
            method: "PATCH",
            query: { addParents: parent_folder_id },
          });
        }
        return formatSuccess(`spreadsheet created: ${title}`, {
          spreadsheetId: id,
          url: `https://docs.google.com/spreadsheets/d/${id}/edit`,
        });
      }),
  );

  server.tool(
    "sheets_add_tab",
    "Add a new tab (sheet) to an existing spreadsheet.",
    {
      spreadsheet_id: z.string(),
      title: z.string(),
    },
    async ({ spreadsheet_id, title }) =>
      handleToolCall(async () => {
        const r = await api.request(
          `${SHEETS}/spreadsheets/${encodeURIComponent(spreadsheet_id)}:batchUpdate`,
          {
            method: "POST",
            json: {
              requests: [{ addSheet: { properties: { title } } }],
            },
          },
        );
        return formatSuccess(`tab added: ${title}`, r);
      }),
  );

  server.tool(
    "sheets_batch_update",
    "Run an arbitrary batchUpdate request payload against a spreadsheet (formatting, merges, conditional rules, freezes, validation, etc.). The argument MUST be a valid `requests` array per the Sheets API.",
    {
      spreadsheet_id: z.string(),
      requests: z.array(z.record(z.string(), z.unknown())).min(1),
    },
    async ({ spreadsheet_id, requests }) =>
      handleToolCall(async () => {
        const r = await api.request(
          `${SHEETS}/spreadsheets/${encodeURIComponent(spreadsheet_id)}:batchUpdate`,
          { method: "POST", json: { requests } },
        );
        return formatSuccess(`batchUpdate applied`, r);
      }),
  );
}
