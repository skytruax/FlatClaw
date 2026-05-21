/**
 * Read-only wrapper around openclaw's `skills.status` gateway method.
 *
 * Used to render the Skills tab in the admin UI. Tenant policy
 * (which-skills-are-allowed) lives in our portal DB
 * (`tenant_skill_settings` + `agents.defaults.skills` materialization in
 * `tenant-skills.ts`). We deliberately DO NOT mutate
 * `skills.entries.<name>.enabled` from this module — that would be a
 * tenant-wide override that conflicts with operators managing openclaw
 * directly via its control UI. Tenant default-deny is enforced at the
 * per-agent allowlist layer instead.
 */

import { getGatewayClient } from "./adapter";

export interface OpenclawSkillRequirement {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
  os?: string[];
}

export interface OpenclawSkill {
  name: string;
  description: string;
  emoji?: string;
  homepage?: string;
  source: string;
  bundled: boolean;
  /** openclaw's own opinion (skills.entries.<name>.enabled === false). */
  disabled: boolean;
  /** Runtime prerequisites met (bins present, OS match, env set). */
  eligible: boolean;
  modelVisible: boolean;
  userInvocable: boolean;
  blockedByAllowlist: boolean;
  blockedByAgentFilter: boolean;
  requirements: OpenclawSkillRequirement;
  missing: OpenclawSkillRequirement;
  filePath?: string;
  baseDir?: string;
}

interface SkillsStatusResponse {
  workspaceDir: string;
  managedSkillsDir: string;
  skills: OpenclawSkill[];
}

/**
 * Live list of every bundled openclaw skill, scoped to one agent's
 * workspace (so OS / runtime requirements are evaluated against the right
 * machine context).
 */
export async function listOpenclawSkills(
  agentId: string,
): Promise<OpenclawSkill[]> {
  const client = getGatewayClient();
  const r = (await client.call("skills.status", { agentId })) as SkillsStatusResponse;
  return Array.isArray(r?.skills) ? r.skills : [];
}
