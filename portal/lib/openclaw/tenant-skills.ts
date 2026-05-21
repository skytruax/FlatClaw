/**
 * Tenant-level allowlist for openclaw OOTB skills.
 *
 * Default-deny: a skill is only visible to any agent on this tenant if
 * `tenant_skill_settings.<skill>.enabled = true`. Enforced exclusively
 * via openclaw's per-agent skill allowlist
 * (`agents.defaults.skills` + per-agent `agents.list[i].skills`) — never
 * by writing `skills.entries.<name>.enabled = false`. Keeps openclaw's
 * `skills.entries` config minimal and lets us layer Cedar policies on top
 * without competing with explicit-disable writes.
 *
 * Lifecycle:
 *
 *   - Admin toggles skill X on  → tenant_skill_settings.X.enabled = true
 *                                 → agents.defaults.skills += [X]
 *   - Admin toggles skill X off → tenant_skill_settings.X.enabled = false
 *                                 → agents.defaults.skills -= [X]
 *   - New session for an agent  → openclaw reads agents.defaults.skills
 *                                 (or per-agent override) at session start
 *
 * Existing agents with explicit `agents.list[i].skills` overrides keep
 * their override (operator may have set it by hand). The defaults flow
 * is what matters for fresh agents and any agent that hasn't been
 * manually scoped.
 */

import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { getGatewayClient } from "./adapter";

interface SkillEntry {
  enabled?: boolean;
  env?: Record<string, string>;
  apiKey?: string | null;
  [k: string]: unknown;
}

interface ConfigBlob {
  agents?: {
    defaults?: { skills?: string[]; [k: string]: unknown };
    list?: Array<{ id?: string; skills?: string[]; [k: string]: unknown }>;
    [k: string]: unknown;
  };
  skills?: { entries?: Record<string, SkillEntry>; [k: string]: unknown };
  [k: string]: unknown;
}

interface ConfigGetResult {
  config: ConfigBlob | string;
  hash?: string;
  baseHash?: string;
  raw?: string;
}

function readBlob(value: unknown): ConfigBlob {
  if (typeof value === "string") return JSON.parse(value) as ConfigBlob;
  return (value as ConfigBlob) ?? {};
}

/** Returns the names of every skill the admin has tenant-enabled, sorted. */
export async function listTenantEnabledSkills(): Promise<string[]> {
  const rows = await db
    .select()
    .from(schema.tenantSkillSettings)
    .where(eq(schema.tenantSkillSettings.enabled, true));
  return rows.map((r) => r.skill).sort();
}

export async function isTenantSkillEnabled(skill: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(schema.tenantSkillSettings)
    .where(eq(schema.tenantSkillSettings.skill, skill))
    .limit(1);
  return rows.length > 0 ? rows[0].enabled === true : false;
}

async function writeTenantSkillEnabled(
  skill: string,
  enabled: boolean,
): Promise<void> {
  const existing = await db
    .select()
    .from(schema.tenantSkillSettings)
    .where(eq(schema.tenantSkillSettings.skill, skill))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(schema.tenantSkillSettings).values({
      skill,
      enabled,
      updatedAt: new Date(),
    });
  } else {
    await db
      .update(schema.tenantSkillSettings)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(schema.tenantSkillSettings.skill, skill));
  }
}

/**
 * Push the current tenant allowlist into openclaw config:
 *
 *   agents.defaults.skills = [...tenantAllowlist]
 *
 * AND clear any explicit `skills.entries.<name>.enabled = false` for skills
 * the admin has tenant-enabled — otherwise openclaw's global disable would
 * mask our tenant approval. We never write `enabled: true` (operators
 * managing openclaw via its own control UI shouldn't see our writes); we
 * only REMOVE the explicit-false flag for tenant-enabled skills. If the
 * operator explicitly disabled a skill at openclaw's layer, our enable
 * here unblocks it — which matches the admin's stated intent.
 *
 * Per-agent overrides (`agents.list[i].skills`) are LEFT ALONE — operators
 * may have hand-scoped specific agents, and we don't want to clobber that.
 *
 * Idempotent — skips the gateway round-trip when nothing would change.
 */
export async function materializeTenantSkillAllowlist(): Promise<{
  changed: boolean;
  allowlist: string[];
}> {
  const allowlist = await listTenantEnabledSkills();
  const client = getGatewayClient();
  const cur = (await client.call("config.get", {})) as ConfigGetResult;
  const blob = readBlob(cur.config ?? cur.raw);
  const before = JSON.stringify(blob);

  blob.agents = blob.agents ?? {};
  blob.agents.defaults = blob.agents.defaults ?? {};
  blob.agents.defaults.skills = allowlist;

  // For every tenant-enabled skill, remove any stale `enabled: false`
  // override openclaw might have. This is the "tenant on really means on"
  // contract.
  const entries = blob.skills?.entries;
  if (entries) {
    for (const name of allowlist) {
      const entry = entries[name];
      if (entry && entry.enabled === false) {
        const { enabled: _drop, ...rest } = entry;
        void _drop;
        if (Object.keys(rest).length === 0) {
          delete entries[name];
        } else {
          entries[name] = rest;
        }
      }
    }
    if (blob.skills && Object.keys(entries).length === 0) {
      delete blob.skills.entries;
    }
  }

  const after = JSON.stringify(blob);
  if (after === before) return { changed: false, allowlist };
  await client.call("config.set", {
    raw: after,
    baseHash: cur.hash ?? cur.baseHash,
  });
  await client.waitUntilReady();
  return { changed: true, allowlist };
}

/**
 * Atomic toggle: write the tenant flag + materialize agents.defaults.skills
 * so future sessions see the change. Returns the new full allowlist.
 */
export async function setTenantSkillEnabled(
  skill: string,
  enabled: boolean,
): Promise<{ allowlist: string[]; changed: boolean }> {
  await writeTenantSkillEnabled(skill, enabled);
  return await materializeTenantSkillAllowlist();
}
