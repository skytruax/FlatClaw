import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { homedir } from "node:os";
import { getGatewayClient } from "./adapter";
import { buildSoul, slugifyAgentId } from "./agent-mapper";
import { buildWorkspaceDefaults } from "./workspace-defaults";
import { syncSkillsForUser } from "./sync-skills";
import { ensureGlobalConfig } from "./skills";

export interface ProvisionArgs {
  userId: string;
  email: string;
  identityName: string;
  identityEmoji: string | null;
  modelRef: string; // e.g. "openai/gemma-4-31b-it"
}

export interface ProvisionResult {
  agentId: string;
  workspace: string;
}

/**
 * Provisions a portal user as an OpenClaw agent.
 *
 *  1) `agents.create` with name, workspace, model, emoji
 *  2) `agents.files.set` to write SOUL.md identity prompt
 *  3) (Phase 3) `config.set` to enable Gmail skills with capability tokens
 *
 * Persists the agentId back into the users row.
 */
export async function provisionAgentForUser(
  args: ProvisionArgs,
): Promise<ProvisionResult> {
  const client = getGatewayClient();
  const agentId = slugifyAgentId(args.email);
  const workspace = `${homedir()}/.openclaw/workspace-${agentId}`;
  const modelId = args.modelRef.split("/").pop() ?? args.modelRef;

  // 0. Make sure browser/verbose/skill-env globals are in place. Idempotent;
  //    only triggers a reload the first time the portal touches a fresh
  //    openclaw config. After this, every subsequent provision pays for at
  //    most one reload (the agents.create below).
  await ensureGlobalConfig();

  // 1. agents.create — gateway creates the workspace dir and bootstraps
  //    several files automatically; we'll overwrite the ones we customize.
  //    Idempotent: if the agent already exists (re-provision), skip create.
  //
  // Deliberately NOT passing `model` here: baking the model into
  // agents.list[i].model breaks the agent the moment that provider goes
  // away (we just hit this when removing openai-dev). Leaving it undefined
  // lets the agent inherit `agents.defaults.model` dynamically, so flipping
  // dev↔prod doesn't strand any agents.
  const createPayload: Record<string, unknown> = {
    name: agentId,
    workspace,
  };
  if (args.identityEmoji) createPayload.emoji = args.identityEmoji;
  try {
    await client.call("agents.create", createPayload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already exists")) throw err;
    console.log(`[provision] agent ${agentId} already exists — repairing files`);
  }

  // Persist agentId IMMEDIATELY so a downstream failure can't leave the
  // gateway with an agent the portal forgets about.
  await db
    .update(schema.users)
    .set({ agentId })
    .where(eq(schema.users.id, args.userId));

  // agents.create triggers a config write → gateway reload. Actively wait
  // for it to finish reloading before piling on workspace file writes,
  // otherwise every following call hits the reload window and the adapter's
  // retry budget gets eaten.
  await client.waitUntilReady();

  // 2. Write all customized workspace files: SOUL.md (identity prompt),
  //    IDENTITY.md (filled in), USER.md (filled in), plus the standard
  //    AGENTS / BOOTSTRAP / HEARTBEAT / TOOLS templates. Each is best-effort
  //    so a single transient failure doesn't bork the whole provisioning.
  const identityArgs = {
    identityName: args.identityName || args.email,
    email: args.email,
    agentId,
  };
  const filesToWrite: { name: string; content: string }[] = [
    { name: "SOUL.md", content: buildSoul({ ...identityArgs, modelId }) },
    ...buildWorkspaceDefaults({
      ...identityArgs,
      identityEmoji: args.identityEmoji,
    }),
  ];

  for (const f of filesToWrite) {
    try {
      await client.call("agents.files.set", {
        agentId,
        name: f.name,
        content: f.content,
      });
    } catch (err) {
      console.warn(`[provision] ${f.name} write failed (non-fatal):`, err);
    }
  }

  // 3. Write the per-user agent's SOUL.md / AGENTS.md / TOOLS.md from
  //    current state. The skill allowlist comes from openclaw's
  //    `agents.defaults.skills` (set by the tenant_skill_settings
  //    materializer); we don't seed any per-user skill choices here.
  //    Best-effort: a transient gateway error here doesn't unwind the
  //    agent, but the admin will need to hit "Sync" once on the user
  //    detail page if it happens.
  try {
    await syncSkillsForUser(args.userId);
  } catch (err) {
    console.warn("[provision] initial skill sync failed (non-fatal):", err);
  }

  // 4. Sync managed MCPs (cpanel, caldav, future Slack/Notion/etc.). For a
  //    brand-new user this is normally a no-op since they have no creds in
  //    the vault yet — but if an admin has been pre-seeding creds, or if a
  //    user is being re-provisioned, this catches them up to the current
  //    enable-state of every registered service. Non-fatal.
  try {
    const { syncAllManagedMcpsForUser } = await import("./managed-mcp");
    await import("./services"); // ensure plugins are registered
    await syncAllManagedMcpsForUser(args.userId);
  } catch (err) {
    console.warn("[provision] managed-mcp sync failed (non-fatal):", err);
  }

  return { agentId, workspace };
}

/**
 * Re-provisions an existing portal user's agent. Used to repair state when
 * the gateway agent has been deleted out from under us (e.g. by a purge).
 */
export async function reprovisionUser(userId: string): Promise<ProvisionResult | null> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (rows.length === 0) return null;
  const u = rows[0];
  const { readDefaultModel, readRegisteredModels } = await import("./agent-mapper");
  const models = readRegisteredModels();
  const modelRef =
    readDefaultModel() ??
    (models.length > 0 ? `${models[0].providerId}/${models[0].id}` : null);
  if (!modelRef) throw new Error("no registered model on the gateway");

  return provisionAgentForUser({
    userId,
    email: u.email,
    identityName: u.identityName ?? u.email,
    identityEmoji: u.identityEmoji,
    modelRef,
  });
}
