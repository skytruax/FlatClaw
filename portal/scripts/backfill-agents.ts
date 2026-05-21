#!/usr/bin/env tsx
/**
 * Backfill script: bring existing agents up to the current portal contract.
 *
 *   1. Re-run syncSkillsForUser for every user that has an agent. This
 *      rewrites AGENTS.md / TOOLS.md with the latest templates, refreshes
 *      skills.entries.<id>.env with the current keyring password, and
 *      writes plugin/browser flags into openclaw.json.
 *   2. For every user with an OAuth token in the DB, ensure that token is
 *      bridged into gog's keyring (catches users who connected before the
 *      bridge step was wired up).
 *
 * Run: pnpm tsx scripts/backfill-agents.ts
 */
import { db, schema } from "../lib/db/client";
import { syncSkillsForUser } from "../lib/openclaw/sync-skills";
import "../lib/openclaw/services";
import { syncAllManagedMcpsForUser } from "../lib/openclaw/managed-mcp";

async function main() {
  const users = await db.select().from(schema.users);
  const agents = users.filter((u) => u.agentId);
  console.log(`found ${agents.length} provisioned agents`);

  for (const u of agents) {
    if (!u.agentId) continue;
    console.log(`[${u.email}] rewriting workspace markdown`);
    await syncSkillsForUser(u.id);
    console.log(`[${u.email}] re-syncing managed MCPs`);
    const result = await syncAllManagedMcpsForUser(u.id);
    console.log(`[${u.email}] mcp sync:`, result);
  }

  console.log("done");
  process.exit(0);
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
