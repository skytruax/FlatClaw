/**
 * Catalog wrapper — replaces N tool registrations with 3 meta-tools.
 *
 * When `<SVC>_MCP_MODE=catalog` is set, the LLM only sees three tools per
 * service:
 *
 *   <prefix>_help(query?)        → terse one-line catalog of available tools
 *   <prefix>_describe(tool)      → full JSON schema for one tool
 *   <prefix>_call(tool, args)    → dispatch into the captured tool handler
 *
 * The actual tools still get "registered" but are captured into an internal
 * map instead of the SDK's tool registry. Schema budget on the LLM side
 * drops from N × ~250 tokens to 3 × ~250 tokens. Trade-off: first use of any
 * tool needs an extra describe call; subsequent uses are direct.
 *
 * Compose ORDER:
 *   server.tool calls → toolset filter (core/full) → compactDescription/Schema → catalog capture
 *
 * The catalog wrapper is the *outermost* layer. If toolset filter rejects a
 * tool, we never see it. If compaction rewrites the description, we capture
 * the rewritten one.
 */
import type { z } from "zod";
import { z as zod } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ToolHandler = (args: unknown, extra?: unknown) => unknown;

export interface CapturedTool {
  name: string;
  description: string;
  paramsSchema?: Record<string, z.ZodTypeAny>;
  handler: ToolHandler;
}

const HELP_DESC =
  "List available tools as terse one-liners. Optional `query` filters by substring (matches name or description). Call this first to discover what's available.";
const DESCRIBE_DESC =
  "Return the full parameter schema for one tool by name. Call before `_call` if you don't already know the parameters.";
const CALL_DESC =
  "Invoke a captured tool by name with args. The full registry is hidden from your tool list to save context — use _help / _describe to discover, then _call to invoke.";

/**
 * Wraps an MCP server with discovery meta-tools.
 *
 * Modes:
 *   - "catalog"  → ONLY 3 meta-tools register (_help/_describe/_call).
 *                  Real tools captured but hidden from the LLM. Saves
 *                  ~60k tokens of schema on a heavy MCP.
 *   - "verbose"  → all real tools register normally, PLUS _help and
 *                  _describe (no _call — model invokes real tools
 *                  directly). Discovery without hiding.
 *   - "off"      → bare passthrough. No meta-tools.
 *
 * Default is "verbose" so help is always available.
 */
export function wrapServerForCatalog(
  baseServer: McpServer,
  opts: {
    prefix: string;
    mode: string;
  },
): McpServer {
  const mode = (opts.mode || "verbose").toLowerCase();
  if (mode === "off") return baseServer;

  const captured = new Map<string, CapturedTool>();
  const baseTool = baseServer.tool.bind(baseServer);
  const isCatalog = mode === "catalog";

  // The wrapped `.tool()`:
  //   catalog → capture only, never passes to SDK
  //   verbose → capture AND pass to SDK (real tool stays advertised)
  const captureTool = ((
    name: string,
    description: string,
    paramsSchema: unknown,
    handler: ToolHandler,
  ) => {
    captured.set(name, {
      name,
      description: description ?? "",
      paramsSchema: (paramsSchema as Record<string, z.ZodTypeAny>) ?? undefined,
      handler,
    });
    if (!isCatalog) {
      return baseTool(name, description, paramsSchema as never, handler as never);
    }
    return undefined;
  }) as unknown as McpServer["tool"];

  // Register the 3 meta-tools directly via baseTool — these ARE exposed.
  baseTool(
    `${opts.prefix}_help`,
    HELP_DESC,
    {
      query: zod
        .string()
        .optional()
        .describe("Optional filter — case-insensitive substring of tool name or description"),
    },
    async (args: unknown) => {
      const q = ((args as { query?: string })?.query ?? "").toLowerCase();
      const items = [...captured.values()]
        .filter((t) =>
          !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
        )
        .map((t) => `${t.name}: ${t.description}`)
        .sort()
        .join("\n");
      return {
        content: [
          {
            type: "text" as const,
            text: items
              ? `${captured.size} tools (filter='${q}' → ${items.split("\n").length} match):\n${items}`
              : "no tools matched",
          },
        ],
      };
    },
  );

  baseTool(
    `${opts.prefix}_describe`,
    DESCRIBE_DESC,
    {
      tool: zod.string().describe("Exact tool name (use _help to discover)"),
    },
    async (args: unknown) => {
      const name = (args as { tool: string }).tool;
      const t = captured.get(name);
      if (!t) {
        return {
          content: [
            { type: "text" as const, text: `unknown tool: ${name}` },
          ],
        };
      }
      // Render the params schema as a JSON-Schema-ish dump so the model
      // can read parameter names + types + descriptions without us
      // shipping the full Zod -> JSON-Schema conversion.
      const params = t.paramsSchema
        ? Object.entries(t.paramsSchema).map(([k, v]) => {
            const def = (v as { _def?: { description?: string; typeName?: string } })._def ?? {};
            const isOptional =
              ((v as { isOptional?: () => boolean }).isOptional?.() ?? false) === true;
            return `  ${k}${isOptional ? "?" : ""}: ${def.typeName ?? "unknown"}${
              def.description ? ` — ${def.description}` : ""
            }`;
          })
        : ["  (no parameters)"];
      return {
        content: [
          {
            type: "text" as const,
            text: `${t.name}\n${t.description}\n\nparams:\n${params.join("\n")}`,
          },
        ],
      };
    },
  );

  // _call is only useful in catalog mode where the real tools are hidden
  // from the LLM. In verbose mode the LLM can call them directly by name.
  if (isCatalog) {
    baseTool(
    `${opts.prefix}_call`,
    CALL_DESC,
    {
      tool: zod.string().describe("Tool name (use _help / _describe first)"),
      args: zod.record(zod.string(), zod.unknown()).optional().describe("Tool arguments"),
    },
    // Cast: the captured handler returns whatever the underlying tool
    // returns. The MCP SDK's overload resolution doesn't see through that,
    // so we explicitly assert the return shape matches what tools produce.
    (async (callArgs: { tool: string; args?: Record<string, unknown> }, extra: unknown) => {
      const { tool: name, args = {} } = callArgs;
      const t = captured.get(name);
      if (!t) {
        return {
          content: [
            { type: "text" as const, text: `unknown tool: ${name}` },
          ],
          isError: true,
        };
      }
      let parsed: unknown = args;
      if (t.paramsSchema) {
        const obj = zod.object(t.paramsSchema);
        const result = obj.safeParse(args);
        if (!result.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: `invalid args for ${name}: ${result.error.message}`,
              },
            ],
            isError: true,
          };
        }
        parsed = result.data;
      }
      return await t.handler(parsed, extra);
    }) as never,
    );
  }

  // Return a Proxy that routes server.tool to capture, leaves everything else
  // alone (including server.connect, server.close, …).
  return new Proxy(baseServer, {
    get(target, prop, receiver) {
      if (prop === "tool") return captureTool;
      return Reflect.get(target, prop, receiver);
    },
  }) as McpServer;
}
