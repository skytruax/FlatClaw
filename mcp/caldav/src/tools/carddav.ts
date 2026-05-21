import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDAVClient, type DAVAddressBook, type DAVVCard } from "tsdav";
import { resolveCreds, type MailboxCreds } from "../auth.js";
import { handleToolCall, formatData, formatSuccess } from "../tool-helpers.js";
import { buildVCard, escapeICalText, type BuildVCardArgs } from "../ical.js";

/**
 * CardDAV tools — address books and contacts (vCard 3.0 / RFC 6352).
 *
 * Each call opens a fresh tsdav client; cheap on the LLM call cadence.
 * Server-side text-match queries vary widely between servers (cPanel CCS
 * is generally permissive). When `addressBookQuery` rejects a filter
 * shape we fall back to fetch-all-and-post-filter.
 */

async function makeCarddavClient(creds: MailboxCreds) {
  return await createDAVClient({
    serverUrl: creds.davUrl,
    credentials: { username: creds.email, password: creds.password },
    authMethod: "Basic",
    defaultAccountType: "carddav",
  });
}

async function findAddressBook(
  client: Awaited<ReturnType<typeof createDAVClient>>,
  url: string,
): Promise<DAVAddressBook> {
  const books = await client.fetchAddressBooks();
  const ab = books.find((b) => b.url === url);
  if (!ab) {
    throw new Error(
      `address book not found: ${url}. Run carddav_list_address_books first.`,
    );
  }
  return ab;
}

async function findVCard(
  client: Awaited<ReturnType<typeof createDAVClient>>,
  ab: DAVAddressBook,
  vcardUrl: string,
): Promise<DAVVCard> {
  const cards = await client.fetchVCards({
    addressBook: ab,
    objectUrls: [vcardUrl],
  });
  const card = cards.find((c) => c.url === vcardUrl);
  if (!card) throw new Error(`vCard not found: ${vcardUrl}`);
  return card;
}

interface ParsedVCard {
  uid: string | null;
  fullName: string | null;
  emails: string[];
  phones: string[];
  org: string | null;
  title: string | null;
  notes: string | null;
  raw: string;
}

/** Crude but reliable vCard 3.0 line parser — handles `KEY;PARAM=VAL:VALUE` shape. */
function parseVCard(raw: string): ParsedVCard {
  const out: ParsedVCard = {
    uid: null,
    fullName: null,
    emails: [],
    phones: [],
    org: null,
    title: null,
    notes: null,
    raw,
  };
  // Unfold continuation lines (RFC 6350 §3.2: lines starting with space/tab continue the previous line).
  const text = raw.replace(/\r?\n[ \t]/g, "");
  for (const line of text.split(/\r?\n/)) {
    if (!line || line === "BEGIN:VCARD" || line === "END:VCARD") continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const key = head.split(";")[0].toUpperCase();
    if (key === "UID") out.uid = value;
    else if (key === "FN") out.fullName = unescapeICal(value);
    else if (key === "EMAIL") out.emails.push(value);
    else if (key === "TEL") out.phones.push(value);
    else if (key === "ORG") out.org = unescapeICal(value);
    else if (key === "TITLE") out.title = unescapeICal(value);
    else if (key === "NOTE") out.notes = unescapeICal(value);
  }
  return out;
}

function unescapeICal(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

const buildArgsSchema = z.object({
  fullName: z.string(),
  emails: z
    .array(
      z.object({
        value: z.string(),
        type: z.enum(["INTERNET", "WORK", "HOME"]).optional(),
      }),
    )
    .optional(),
  phones: z
    .array(
      z.object({
        value: z.string(),
        type: z.enum(["CELL", "WORK", "HOME", "FAX"]).optional(),
      }),
    )
    .optional(),
  org: z.string().optional(),
  title: z.string().optional(),
  notes: z.string().optional(),
});

export function registerCarddavTools(server: McpServer) {
  server.tool(
    "carddav_list_address_books",
    "List the user's CardDAV address books.",
    {},
    async () =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const client = await makeCarddavClient(creds);
        const books = await client.fetchAddressBooks();
        return formatData(
          books.map((b) => ({ url: b.url, displayName: b.displayName, ctag: b.ctag })),
        );
      }),
  );

  server.tool(
    "carddav_list_contacts",
    "List every vCard in an address book. Returns parsed name/emails/phones/org per contact plus the URL + etag for later updates.",
    {
      addressBookUrl: z.string(),
    },
    async ({ addressBookUrl }) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const client = await makeCarddavClient(creds);
        const ab = await findAddressBook(client, addressBookUrl);
        const cards = await client.fetchVCards({ addressBook: ab });
        return formatData(
          cards.map((c) => {
            const p = parseVCard(c.data ?? "");
            return {
              url: c.url,
              etag: c.etag,
              uid: p.uid,
              fullName: p.fullName,
              emails: p.emails,
              phones: p.phones,
              org: p.org,
              title: p.title,
            };
          }),
        );
      }),
  );

  server.tool(
    "carddav_get_contact",
    "Fetch one vCard by its URL. Returns parsed fields + raw vCard + etag.",
    {
      addressBookUrl: z.string(),
      vcardUrl: z.string(),
    },
    async ({ addressBookUrl, vcardUrl }) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const client = await makeCarddavClient(creds);
        const ab = await findAddressBook(client, addressBookUrl);
        const card = await findVCard(client, ab, vcardUrl);
        const p = parseVCard(card.data ?? "");
        return formatData({
          url: card.url,
          etag: card.etag,
          uid: p.uid,
          fullName: p.fullName,
          emails: p.emails,
          phones: p.phones,
          org: p.org,
          title: p.title,
          notes: p.notes,
          raw: p.raw,
        });
      }),
  );

  server.tool(
    "carddav_search_contacts",
    "Search across an address book for contacts whose FN / EMAIL / ORG / TITLE / NOTE contains the query (case-insensitive). Server-side filtering is server-dependent; this tool falls back to a client-side filter if needed.",
    {
      addressBookUrl: z.string(),
      query: z.string(),
      fields: z
        .array(z.enum(["FN", "EMAIL", "ORG", "TITLE", "NOTE", "TEL"]))
        .optional()
        .describe("Restrict match to these fields. Defaults to all of FN/EMAIL/ORG."),
      limit: z.number().int().min(1).max(500).default(50),
    },
    async ({ addressBookUrl, query, fields, limit }) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const client = await makeCarddavClient(creds);
        const ab = await findAddressBook(client, addressBookUrl);
        const cards = await client.fetchVCards({ addressBook: ab });
        const target = query.toLowerCase();
        const wanted = fields ?? ["FN", "EMAIL", "ORG"];
        const out: unknown[] = [];
        for (const c of cards) {
          const p = parseVCard(c.data ?? "");
          const haystack: string[] = [];
          if (wanted.includes("FN") && p.fullName) haystack.push(p.fullName);
          if (wanted.includes("EMAIL")) haystack.push(...p.emails);
          if (wanted.includes("ORG") && p.org) haystack.push(p.org);
          if (wanted.includes("TITLE") && p.title) haystack.push(p.title);
          if (wanted.includes("NOTE") && p.notes) haystack.push(p.notes);
          if (wanted.includes("TEL")) haystack.push(...p.phones);
          if (haystack.some((h) => h.toLowerCase().includes(target))) {
            out.push({
              url: c.url,
              etag: c.etag,
              uid: p.uid,
              fullName: p.fullName,
              emails: p.emails,
              phones: p.phones,
              org: p.org,
              title: p.title,
            });
            if (out.length >= limit) break;
          }
        }
        return formatData(out);
      }),
  );

  server.tool(
    "carddav_create_contact",
    "Create a new vCard 3.0 contact in the given address book. UID is auto-generated.",
    {
      addressBookUrl: z.string(),
      ...buildArgsSchema.shape,
    },
    async (args) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const client = await makeCarddavClient(creds);
        const ab = await findAddressBook(client, args.addressBookUrl);
        const buildArgs: BuildVCardArgs = {
          fullName: args.fullName,
          emails: args.emails,
          phones: args.phones,
          org: args.org,
          title: args.title,
          notes: args.notes,
        };
        const { uid, vCard } = buildVCard(buildArgs);
        const res = await client.createVCard({
          addressBook: ab,
          filename: `${uid}.vcf`,
          vCardString: vCard,
        });
        return formatSuccess(`contact created: ${args.fullName}`, {
          uid,
          status: (res as { status?: number }).status,
          url: (res as { url?: string }).url,
        });
      }),
  );

  server.tool(
    "carddav_update_contact",
    "Update an existing vCard (etag-aware). On 412 Precondition Failed the tool refetches the current etag and retries once. To replace specific fields, fetch via carddav_get_contact, edit the parsed structure, and pass the full new field set here.",
    {
      addressBookUrl: z.string(),
      vcardUrl: z.string(),
      fullName: z.string(),
      emails: z
        .array(
          z.object({
            value: z.string(),
            type: z.enum(["INTERNET", "WORK", "HOME"]).optional(),
          }),
        )
        .optional(),
      phones: z
        .array(
          z.object({
            value: z.string(),
            type: z.enum(["CELL", "WORK", "HOME", "FAX"]).optional(),
          }),
        )
        .optional(),
      org: z.string().optional(),
      title: z.string().optional(),
      notes: z.string().optional(),
    },
    async (args) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const client = await makeCarddavClient(creds);
        const ab = await findAddressBook(client, args.addressBookUrl);
        const existing = await findVCard(client, ab, args.vcardUrl);
        const oldParsed = parseVCard(existing.data ?? "");
        const { uid, vCard } = buildVCard({
          uid: oldParsed.uid ?? undefined,
          fullName: args.fullName,
          emails: args.emails,
          phones: args.phones,
          org: args.org,
          title: args.title,
          notes: args.notes,
        });
        let res;
        try {
          res = await client.updateVCard({
            vCard: { url: existing.url, etag: existing.etag, data: vCard },
          });
        } catch (err) {
          const status = (err as { status?: number }).status;
          if (status !== 412) throw err;
          const fresh = await findVCard(client, ab, args.vcardUrl);
          res = await client.updateVCard({
            vCard: { url: fresh.url, etag: fresh.etag, data: vCard },
          });
        }
        return formatSuccess(`contact updated: ${args.fullName}`, {
          uid,
          status: (res as { status?: number }).status,
        });
      }),
  );

  server.tool(
    "carddav_delete_contact",
    "Delete a vCard (etag-aware).",
    {
      addressBookUrl: z.string(),
      vcardUrl: z.string(),
    },
    async ({ addressBookUrl, vcardUrl }) =>
      handleToolCall(async () => {
        const creds = await resolveCreds();
        const client = await makeCarddavClient(creds);
        const ab = await findAddressBook(client, addressBookUrl);
        const card = await findVCard(client, ab, vcardUrl);
        const res = await client.deleteVCard({
          vCard: { url: card.url, etag: card.etag },
        });
        return formatSuccess(`contact deleted`, {
          status: (res as { status?: number }).status,
        });
      }),
  );

  // touch the import so unused-import lint stays quiet
  void escapeICalText;
}
