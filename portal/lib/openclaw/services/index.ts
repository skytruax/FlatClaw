/**
 * Auto-load every managed MCP service plugin. Importing this file (once,
 * anywhere) makes every plugin's `registerManagedMcpService(...)` call run,
 * populating the registry consumed by `provisionManagedMcpForUser()`.
 *
 * The actual import list is GENERATED at build time by
 * `scripts/gen-service-plugins.mjs` (run from `predev`/`prebuild`), which
 * scans for `*.plugin.ts` files. That keeps this tracked file free of any
 * specific service name, so private add-on plugins (present only on the
 * private branch's working tree) are picked up where they exist and omitted
 * from the public build automatically — no hardcoded import to break
 * `next build` when a plugin file is absent.
 *
 * Adding a new service:
 *   1. Add a new vault credential shape (generic service vault, or OAuth).
 *   2. Add a `<svc>.plugin.ts` next to this file calling
 *      `registerManagedMcpService(...)`. The codegen picks it up.
 *   3. Wire the bridge endpoint via the dynamic `[service]-token` route.
 */
import "./_generated-plugins";
