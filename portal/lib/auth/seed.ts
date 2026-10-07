import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";

let seeded = false;
let usersSeeded = false;

interface SeedUser {
  email: string;
  password: string;
  name?: string;
  role?: "admin" | "user";
}

/**
 * Seed a fixed set of team users + provision their OpenClaw agents on boot.
 *
 * Reads PORTAL_SEED_USERS (JSON array of {email, password, name?, role?}).
 * Idempotent: a user that already exists is skipped; a user that exists but has
 * no agent yet gets provisioned. New users are created (bcrypt password) then
 * provisioned (agent + workspace + SOUL/AGENTS files + skill/MCP sync).
 *
 * Runs from instrumentation.ts AFTER the gateway is up (start-control.sh starts
 * the gateway before the Portal), so agents.create over loopback works.
 */
export async function seedUsersFromEnv(): Promise<void> {
  if (usersSeeded) return;
  usersSeeded = true;
  const raw = process.env.PORTAL_SEED_USERS;
  if (!raw) return;

  let list: SeedUser[];
  try {
    list = JSON.parse(raw) as SeedUser[];
  } catch (err) {
    console.error("[seed-users] PORTAL_SEED_USERS is not valid JSON:", err);
    return;
  }
  if (!Array.isArray(list) || list.length === 0) return;

  // Lazy import so the auth path doesn't eagerly pull in the gateway adapter.
  const { provisionAgentForUser } = await import("@/lib/openclaw/provision");
  const { INFERENCE_PROVIDER_ID, readInferenceSettings } = await import("@/lib/settings/inference");
  const modelRef = `${INFERENCE_PROVIDER_ID}/${readInferenceSettings().modelId}`;

  for (const u of list) {
    const email = String(u.email ?? "").trim().toLowerCase();
    if (!email || !u.password) {
      console.warn("[seed-users] skipping entry with missing email/password");
      continue;
    }
    const identityName = u.name?.trim() || email.split("@")[0];
    const role = u.role === "admin" ? "admin" : "user";
    try {
      const existing = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);

      let userId: string;
      if (existing.length === 0) {
        userId = randomUUID();
        await db.insert(schema.users).values({
          id: userId,
          email,
          passwordHash: await bcrypt.hash(u.password, 10),
          role,
          identityName,
        });
        console.log(`[seed-users] created ${role} ${email}`);
      } else {
        userId = existing[0].id;
        if (existing[0].agentId) {
          // Already provisioned. Refresh the workspace prompts (SOUL.md /
          // AGENTS.md) so template updates — e.g. new tool guidance — reach
          // existing agents on redeploy without a manual admin "Sync". Cheap and
          // idempotent; leaves the user's password + agent otherwise untouched.
          try {
            const { syncSkillsForUser } = await import("@/lib/openclaw/sync-skills");
            await syncSkillsForUser(userId);
            console.log(`[seed-users] ${email} re-synced workspace prompts`);
          } catch (err) {
            console.warn(`[seed-users] ${email} prompt re-sync failed (non-fatal):`, err);
          }
          continue;
        }
        console.log(`[seed-users] ${email} exists without an agent — provisioning`);
      }

      await provisionAgentForUser({
        userId,
        email,
        identityName,
        identityEmoji: null,
        modelRef,
      });
      console.log(`[seed-users] provisioned agent for ${email}`);
    } catch (err) {
      console.error(`[seed-users] ${email} failed (non-fatal):`, err);
    }
  }
}

export async function seedAdminFromEnv(): Promise<void> {
  if (seeded) return;
  const email = process.env.PORTAL_ADMIN_EMAIL;
  const password = process.env.PORTAL_ADMIN_PASSWORD;
  if (!email || !password) {
    seeded = true;
    return;
  }

  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (existing.length === 0) {
    const passwordHash = await bcrypt.hash(password, 10);
    await db.insert(schema.users).values({
      id: randomUUID(),
      email,
      passwordHash,
      role: "admin",
      identityName: email.split("@")[0],
    });
    console.log(`[seed] admin user created: ${email}`);
  } else if (existing[0].role !== "admin") {
    await db
      .update(schema.users)
      .set({ role: "admin" })
      .where(eq(schema.users.id, existing[0].id));
    console.log(`[seed] promoted ${email} to admin`);
  }

  seeded = true;
}
