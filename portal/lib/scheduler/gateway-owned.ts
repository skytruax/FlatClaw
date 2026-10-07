/**
 * Jobs the gateway owns, as opposed to tasks a user scheduled.
 *
 * Since openclaw 2026.8 the gateway's own monitors are ordinary cron jobs: a
 * heartbeat for the default agent and a "skill collection review" for EVERY
 * agent (created disabled under the tenant baseline, which turns the Skill
 * Workshop's autonomous mode off). They are config-owned — the gateway
 * re-creates them and reverts edits — so to a portal user they are not
 * scheduled tasks. They are told apart by a reserved `declarationKey`
 * namespace; this mirrors `isSystemMonitorDeclaration` in
 * openclaw/src/cron/system-owned-declaration.ts.
 *
 * Pure module (no DB, no gateway client) so the contract probe can share it.
 */
const GATEWAY_OWNED_DECLARATIONS = ["heartbeat:", "skill-collection-review:"];

export function isGatewayOwnedJob(job: { declarationKey?: unknown }): boolean {
  const key = job.declarationKey;
  return typeof key === "string" && GATEWAY_OWNED_DECLARATIONS.some((ns) => key.startsWith(ns));
}
