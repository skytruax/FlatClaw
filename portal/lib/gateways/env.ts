/**
 * The environment a per-user gateway child gets. Everything in it is visible
 * to the agent's shell (`exec` runs as the gateway's account), so the
 * portal's own secrets and anything that looks like a credential stay out.
 * MCP servers get what they need from their config entries, which the portal
 * writes, not from the environment.
 */
import { join } from "node:path";

/** Environment the portal must never pass to a gateway. */
export const PORTAL_ONLY_ENV: ReadonlySet<string> = new Set([
  "AUTH_SECRET", "NEXTAUTH_SECRET", "PORTAL_SECRETS_KEY", "PORTAL_ADMIN_EMAIL", "PORTAL_ADMIN_PASSWORD",
  "PORTAL_SEED_USERS", "PORTAL_GATEWAY_TOKEN", "PORTAL_GATEWAY_URL", "PORTAL_GATEWAY_DEVICE_KEY",
  "PORTAL_DB_PATH", "PORTAL_MIGRATIONS_DIR", "PORTAL_OPENCLAW_CONFIG", "PORTAL_OPENCLAW_STATE_DIR",
  "OPENCLAW_GATEWAY_TOKEN", "DATABASE_URL", "NORTHFLANK_API_TOKEN",
  "OPENCLAW_STATE_DIR", "OPENCLAW_CONFIG_PATH", "OPENCLAW_PROFILE", "OPENCLAW_HOME", "HOME",
]);

/** Names that look like credentials are dropped too, unless FLATCLAW_GATEWAY_ENV_ALLOW names them. */
export const SECRET_LIKE_ENV = /(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|CREDENTIALS?|REFRESH|GRANT_CODE|_KEY)$/i;

export type EnvMap = Record<string, string | undefined>;

export function gatewayChildEnv(parent: EnvMap, gateway: { stateDir: string } | null): NodeJS.ProcessEnv {
  const allow = new Set((parent.FLATCLAW_GATEWAY_ENV_ALLOW ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  // Built as a plain map; Next.js types NODE_ENV as required on ProcessEnv.
  const env: EnvMap = {};
  for (const [k, v] of Object.entries(parent)) {
    if (v === undefined) continue;
    if (allow.has(k)) { env[k] = v; continue; }
    if (PORTAL_ONLY_ENV.has(k)) continue;
    if (SECRET_LIKE_ENV.test(k)) continue;
    env[k] = v;
  }
  if (gateway) {
    env.HOME = join(gateway.stateDir, "home");
    env.OPENCLAW_STATE_DIR = gateway.stateDir;
    env.OPENCLAW_CONFIG_PATH = join(gateway.stateDir, "openclaw.json");
  } else if (parent.HOME) {
    env.HOME = parent.HOME;
  }
  return env as NodeJS.ProcessEnv;
}
