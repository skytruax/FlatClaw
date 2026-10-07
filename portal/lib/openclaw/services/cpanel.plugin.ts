/**
 * cPanel MCP service plugin.
 *
 * Wires the cPanel MCP into the generic `managed-mcp.ts` provisioner +
 * declares the per-user credential shape so the admin UI can render a
 * generic form. Once imported, callers use
 * `provisionManagedMcpForUser("cpanel", userId)` and the dispatcher
 * handles MCP registration, RBAC deny-list, capability tokens, and form
 * rendering.
 */
import {
  registerManagedMcpService,
  type ManagedCredentialStatus,
} from "../managed-mcp";
import {
  setCpanelCredential,
  readCpanelStatus,
  deleteCpanelCredential,
} from "@/lib/credentials/cpanel";

registerManagedMcpService({
  service: "cpanel",
  label: "cPanel hosting",
  emoji: "🛠️",
  prefix: "cpanel-",
  capabilityScope: "cpanel.token",
  entryEnvVar: "FLATCLAW_CPANEL_MCP_ENTRY",
  description:
    "cPanel UAPI / API2 (admin tier — root cPanel account access). Files, email accounts, DNS, MySQL, FTP, PHP, SSL, backups.",
  buildExtraEnv: () => {
    // Full toolset everywhere by default. Dev is on A100 40 GB now —
    // 100k+ active KV pool comfortably fits the full ~46k-token schema
    // budget, with room for transcript on top. Override per-tenant via
    // FLATCLAW_CPANEL_MCP_TOOLSET=core if a future smaller-GPU lane
    // needs the trim. Mode = "verbose" so _help/_describe ride along
    // with real tools (not the catalog 3-step dance).
    const toolset = process.env.FLATCLAW_CPANEL_MCP_TOOLSET ?? "full";
    const mode = process.env.FLATCLAW_CPANEL_MCP_MODE ?? "verbose";
    return { CPANEL_MCP_TOOLSET: toolset, CPANEL_MCP_MODE: mode };
  },
  auth: {
    kind: "form",
    fields: [
      {
        name: "username",
        label: "cPanel username",
        placeholder: "skyler",
        type: "text",
        required: true,
        help: "The cPanel account username (NOT an email). Often a short reseller-prefixed name like d17367 or fcskyler.",
      },
      {
        name: "apiToken",
        label: "API token",
        placeholder: "HE02ADH2MQ64E…",
        type: "secret",
        required: true,
        help: "Generated in WHM → Manage API Tokens (root) or cPanel → Manage API Tokens (per-user).",
      },
      {
        name: "serverUrl",
        label: "Server URL",
        placeholder: "https://flatclaw.org:2083",
        type: "url",
        required: true,
        defaultValue: "https://flatclaw.org:2083",
        help: "cPanel UAPI endpoint. Defaults to port 2083.",
      },
      {
        name: "verifySsl",
        label: "Verify SSL",
        type: "boolean",
        defaultValue: true,
        help: "Uncheck only if the cPanel host has a self-signed cert.",
      },
    ],
  },
  async setCredential(userId, payload) {
    const username = String(payload.username ?? "").trim();
    const apiToken = String(payload.apiToken ?? "").trim();
    const serverUrl = String(payload.serverUrl ?? "").trim();
    if (!username || !apiToken || !serverUrl) {
      throw new Error("username, apiToken, and serverUrl are required");
    }
    await setCpanelCredential(userId, {
      username,
      apiToken,
      serverUrl,
      verifySsl: payload.verifySsl !== false,
    });
  },
  async readStatus(userId): Promise<ManagedCredentialStatus> {
    const s = await readCpanelStatus(userId);
    return {
      connected: s.connected,
      identity: s.username ? `${s.username} @ ${s.serverUrl ?? "?"}` : null,
      updatedAt: s.updatedAt ? s.updatedAt.getTime() : null,
      lastUsedAt: s.lastUsedAt ? s.lastUsedAt.getTime() : null,
      meta: { verifySsl: s.verifySsl },
    };
  },
  async deleteCredential(userId) {
    await deleteCpanelCredential(userId);
  },
});
