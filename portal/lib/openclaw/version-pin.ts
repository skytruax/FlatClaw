/**
 * Pinned openclaw version FlatClaw is verified against.
 *
 * Why pin: our RBAC (`agent-tool-policy.ts`) and capability-token bridge
 * depend on openclaw's *runtime* behavior — specifically `applyToolPolicyPipeline`
 * filtering tool names by glob patterns, and the `<safeServerName>__<tool>`
 * MCP tool naming convention (server part cut to 30 characters). Both are
 * public schema today, but if openclaw ever changes the tool-name separator
 * or the policy pipeline order, our deny patterns silently misfire and
 * Phase 1 RBAC stops enforcing.
 *
 * It also pins a set of *defaults*. openclaw is built for one operator, and
 * its defaults drift toward convenience for that operator — 2026.8/2026.9
 * turned on cross-agent session access, agent-to-agent messaging and a larger
 * built-in tool set. `tenant-baseline.ts` holds the values FlatClaw fixes, and
 * a new pin has to be checked against it.
 *
 * Bumping the pin:
 *   1. Read openclaw's release notes between the current pin and the new one
 *      (openclaw/CHANGELOG/<version>.md; wire and schema history is in
 *      openclaw/packages/gateway-protocol/CHANGELOG.md). The gateway protocol
 *      number is NOT a signal — it has stayed 4 across breaking changes.
 *   2. Stage it: on a COPY of ~/.openclaw, install the candidate, run
 *      `openclaw doctor --fix --non-interactive`, start the gateway.
 *   3. From portal/, against that gateway:
 *        npm run typecheck && npm test        (what we compute)
 *        npm run test:gateway                 (what the gateway does with it)
 *      The second one is scripts/gateway-contract-probe.ts. It must pass —
 *      in particular `tools.builtin-roster` (no new upstream tool reaches
 *      agents undecided) and the `isolation.*` checks.
 *   4. Update the constants below, and the Node requirement if it moved
 *      (infra/kirk/Dockerfile.control NODE_VERSION, portal/.nvmrc).
 *   5. Record what changed in the operator notes and update the version in
 *      README.md.
 *
 * Mismatch policy:
 *   - We don't refuse to run if the gateway differs from the pin — that would
 *     block local dev whenever upstream releases a patch. The adapter logs a
 *     warning when the gateway it connected to reports another version
 *     (`describeGatewayVersionDrift`), and the admin gateway-status endpoint
 *     reports both.
 */

/**
 * The openclaw version every Phase 1 / 2 / 3 design decision in this
 * repo has been tested against. Bump only after the procedure above.
 */
export const OPENCLAW_VERIFIED_VERSION = "2026.9.8";

/**
 * Date the verification ran (UTC ISO date). Surfaced to admins so an
 * operator inspecting an RBAC decision knows how stale the pin is relative
 * to upstream.
 */
export const OPENCLAW_VERIFIED_AT = "2026-10-05";

/**
 * Node versions the pinned openclaw runs on (its package.json `engines`).
 * 2026.9.3 dropped Node 22: its node:sqlite decoder truncates TEXT at embedded
 * NULs, and openclaw now keeps sessions in SQLite.
 */
export const OPENCLAW_NODE_REQUIREMENT = ">=24.16.0 <25 || >=26.1.0";

export interface OpenclawVersionStatus {
  /** Version the connected gateway reported in its hello, if it did. */
  gateway: string | null;
  /** The pinned version this codebase was verified against. */
  verified: string;
  /** When the pin was last verified (ISO date). */
  verifiedAt: string;
  status: "match" | "drift" | "unknown";
}

export function openclawVersionStatus(gatewayVersion: string | null): OpenclawVersionStatus {
  return {
    gateway: gatewayVersion,
    verified: OPENCLAW_VERIFIED_VERSION,
    verifiedAt: OPENCLAW_VERIFIED_AT,
    status:
      gatewayVersion === null
        ? "unknown"
        : gatewayVersion === OPENCLAW_VERIFIED_VERSION
          ? "match"
          : "drift",
  };
}

/** A one-line warning when the running gateway is not the verified version, else null. */
export function describeGatewayVersionDrift(gatewayVersion: string | null): string | null {
  if (gatewayVersion === null || gatewayVersion === OPENCLAW_VERIFIED_VERSION) return null;
  return `[openclaw-pin] the gateway is openclaw ${gatewayVersion}; FlatClaw was last verified against ${OPENCLAW_VERIFIED_VERSION} (${OPENCLAW_VERIFIED_AT}). RBAC, tool naming and defaults may differ — run \`npm run test:gateway\` from portal/ before trusting it.`;
}
