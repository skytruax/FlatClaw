/**
 * E2E probe: drop Skyler's (flatclaw.org user) cPanel root creds in the vault,
 * provision the per-user MCP, and report the resulting state. Run from the
 * portal dir with the .env.local loaded:
 *
 *   pnpm tsx scripts/e2e-cpanel-vault.ts
 */
// env should be loaded by the caller (set -a; . .env.local; set +a)
import { setCpanelCredential, readCpanelStatus } from "../lib/credentials/cpanel";
import { provisionCpanelMcpForUser } from "../lib/openclaw/cpanel-mcp";
import { syncSkillsForUser } from "../lib/openclaw/sync-skills";
import { db, schema } from "../lib/db/client";
import { eq } from "drizzle-orm";

const SKYLER_FC_EMAIL = "skyler@flatclaw.org";
const ROOT_USERNAME = "d17367";
const ROOT_TOKEN = "HE02ADH2MQ64ESR6UYBN7YH262MBLAET";
const ROOT_URL = "https://flatclaw.org:2083";

async function main() {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, SKYLER_FC_EMAIL))
    .limit(1);
  if (rows.length === 0) {
    console.error(`no user with email ${SKYLER_FC_EMAIL}`);
    process.exit(1);
  }
  const u = rows[0];
  console.log("user:", u.id, u.email, "agent=", u.agentId);

  await setCpanelCredential(u.id, {
    username: ROOT_USERNAME,
    apiToken: ROOT_TOKEN,
    serverUrl: ROOT_URL,
    verifySsl: true,
  });
  console.log("vault row written");

  const status = await readCpanelStatus(u.id);
  console.log("status:", status);

  const r = await provisionCpanelMcpForUser(u.id);
  console.log("provisioned:", r);

  if (u.agentId) {
    await syncSkillsForUser(u.id);
    console.log("synced agent workspace markdown");
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("FATAL:", err);
    process.exit(1);
  },
);
