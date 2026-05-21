import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GoogleApiClient } from "../google-client.js";
import { handleToolCall, formatData, formatSuccess } from "../tool-helpers.js";

const PEOPLE = "https://people.googleapis.com/v1";

const PERSON_FIELDS =
  "names,emailAddresses,phoneNumbers,addresses,organizations,biographies,birthdays,urls,memberships,metadata";

const emailSchema = z.object({
  value: z.string(),
  type: z.string().optional().describe("e.g. 'home', 'work'."),
});

const phoneSchema = z.object({
  value: z.string(),
  type: z.string().optional(),
});

export function registerPeopleTools(server: McpServer, api: GoogleApiClient): void {
  server.tool(
    "contacts_list",
    "List the user's Google Contacts (My Contacts collection). Paginated; default 100.",
    {
      max: z.number().int().min(1).max(1000).optional(),
      page_token: z.string().optional(),
    },
    async ({ max, page_token }) =>
      handleToolCall(async () => {
        const r = await api.request(`${PEOPLE}/people/me/connections`, {
          query: {
            personFields: PERSON_FIELDS,
            pageSize: max ?? 100,
            pageToken: page_token,
            sortOrder: "LAST_MODIFIED_DESCENDING",
          },
        });
        return formatData(r);
      }),
  );

  server.tool(
    "contacts_search",
    "Search the user's Contacts by free-text query (matches across name/email/phone/org).",
    {
      query: z.string(),
      max: z.number().int().min(1).max(500).optional(),
    },
    async ({ query, max }) =>
      handleToolCall(async () => {
        const r = await api.request(`${PEOPLE}/people:searchContacts`, {
          query: {
            query,
            pageSize: max ?? 50,
            readMask: PERSON_FIELDS,
          },
        });
        return formatData(r);
      }),
  );

  server.tool(
    "contacts_get",
    "Fetch a single Google Contact by resource name (e.g. 'people/c12345').",
    {
      resource_name: z.string(),
    },
    async ({ resource_name }) =>
      handleToolCall(async () => {
        const r = await api.request(
          `${PEOPLE}/${encodeURIComponent(resource_name)}`,
          { query: { personFields: PERSON_FIELDS } },
        );
        return formatData(r);
      }),
  );

  server.tool(
    "contacts_create",
    "Create a new Google Contact in the user's My Contacts collection.",
    {
      given_name: z.string().optional(),
      family_name: z.string().optional(),
      full_name: z
        .string()
        .optional()
        .describe(
          "Display name. If omitted, derived from given_name + family_name.",
        ),
      emails: z.array(emailSchema).optional(),
      phones: z.array(phoneSchema).optional(),
      organization: z.string().optional(),
      title: z.string().optional(),
      notes: z.string().optional(),
    },
    async (args) =>
      handleToolCall(async () => {
        const body: Record<string, unknown> = {};
        const names: Record<string, unknown> = {};
        if (args.given_name) names.givenName = args.given_name;
        if (args.family_name) names.familyName = args.family_name;
        if (args.full_name) names.displayName = args.full_name;
        if (Object.keys(names).length) body.names = [names];
        if (args.emails?.length) body.emailAddresses = args.emails;
        if (args.phones?.length) body.phoneNumbers = args.phones;
        if (args.organization || args.title) {
          body.organizations = [
            { name: args.organization, title: args.title },
          ];
        }
        if (args.notes) body.biographies = [{ value: args.notes }];
        const r = await api.request(`${PEOPLE}/people:createContact`, {
          method: "POST",
          json: body,
        });
        return formatSuccess(
          `contact created: ${args.full_name ?? args.given_name ?? args.family_name ?? "(unnamed)"}`,
          r,
        );
      }),
  );

  server.tool(
    "contacts_update",
    "Update fields on an existing contact. Pass only the fields you want to change. The People API requires `update_person_fields` listing which sections you're touching — this tool fills it in automatically based on which args you supplied.",
    {
      resource_name: z.string(),
      etag: z
        .string()
        .describe(
          "Required by Google for optimistic concurrency. Get it from contacts_get.",
        ),
      given_name: z.string().optional(),
      family_name: z.string().optional(),
      full_name: z.string().optional(),
      emails: z.array(emailSchema).optional(),
      phones: z.array(phoneSchema).optional(),
      organization: z.string().optional(),
      title: z.string().optional(),
      notes: z.string().optional(),
    },
    async (args) =>
      handleToolCall(async () => {
        const body: Record<string, unknown> = { etag: args.etag };
        const fieldsTouched: string[] = [];
        const names: Record<string, unknown> = {};
        if (args.given_name) names.givenName = args.given_name;
        if (args.family_name) names.familyName = args.family_name;
        if (args.full_name) names.displayName = args.full_name;
        if (Object.keys(names).length) {
          body.names = [names];
          fieldsTouched.push("names");
        }
        if (args.emails) {
          body.emailAddresses = args.emails;
          fieldsTouched.push("emailAddresses");
        }
        if (args.phones) {
          body.phoneNumbers = args.phones;
          fieldsTouched.push("phoneNumbers");
        }
        if (args.organization || args.title) {
          body.organizations = [{ name: args.organization, title: args.title }];
          fieldsTouched.push("organizations");
        }
        if (args.notes !== undefined) {
          body.biographies = [{ value: args.notes }];
          fieldsTouched.push("biographies");
        }
        if (fieldsTouched.length === 0) {
          throw new Error("contacts_update: at least one field must be supplied");
        }
        const r = await api.request(
          `${PEOPLE}/${encodeURIComponent(args.resource_name)}:updateContact`,
          {
            method: "PATCH",
            query: { updatePersonFields: fieldsTouched.join(",") },
            json: body,
          },
        );
        return formatSuccess(`contact updated`, r);
      }),
  );

  server.tool(
    "contacts_delete",
    "Delete a Google Contact by resource name.",
    {
      resource_name: z.string(),
    },
    async ({ resource_name }) =>
      handleToolCall(async () => {
        await api.request(
          `${PEOPLE}/${encodeURIComponent(resource_name)}:deleteContact`,
          { method: "DELETE" },
        );
        return formatSuccess(`contact ${resource_name} deleted`);
      }),
  );

  server.tool(
    "contacts_list_directory",
    "Search the user's Workspace directory (other people in the same Google Workspace org). Read-only.",
    {
      query: z.string(),
      max: z.number().int().min(1).max(500).optional(),
    },
    async ({ query, max }) =>
      handleToolCall(async () => {
        const r = await api.request(`${PEOPLE}/people:searchDirectoryPeople`, {
          query: {
            query,
            readMask: PERSON_FIELDS,
            sources: "DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE",
            pageSize: max ?? 50,
          },
        });
        return formatData(r);
      }),
  );

  server.tool(
    "contacts_me",
    "Fetch the connected Google account's own profile.",
    {},
    async () =>
      handleToolCall(async () => {
        const r = await api.request(`${PEOPLE}/people/me`, {
          query: { personFields: PERSON_FIELDS },
        });
        return formatData(r);
      }),
  );
}
