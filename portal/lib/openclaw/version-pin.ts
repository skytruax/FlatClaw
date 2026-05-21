/**
 * Pinned openclaw version FlatClaw is verified against.
 *
 * Why pin: our RBAC (`agent-tool-policy.ts`) and capability-token bridge
 * depend on openclaw's *runtime* behavior — specifically `applyToolPolicyPipeline`
 * filtering tool names by glob patterns, and the `<safeServerName>__<tool>`
 * MCP tool naming convention. Both are public schema today, but if openclaw
 * ever changes the tool-name separator or the policy pipeline order, our deny
 * patterns silently misfire and Phase 1 RBAC stops enforcing.
 *
 * Bumping the pin:
 *   1. Read openclaw's CHANGELOG between the current pin and the new one.
 *   2. Re-run `npx tsx --test lib/openclaw/agent-tool-policy.test.ts` against
 *      the new openclaw locally.
 *   3. Re-run the Keith-blocked e2e probe against the new openclaw.
 *   4. Update the constant below + this file's `verifiedAt` to today.
 *   5. Update Dockerfiles / install scripts to match.
 *
 * Mismatch policy:
 *   - We don't refuse to start if the installed openclaw differs from the pin
 *     — that would block local dev whenever upstream releases a patch. Instead
 *     `assertOpenclawVersionCompatible()` logs a structured warning when a
 *     drift is detected. The portal and the gateway run; the audit log shows
 *     which version was actually in use when an RBAC decision was made.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * The openclaw version every Phase 1 / 2 / 3 design decision in this
 * repo has been tested against. Bump only after the procedure above.
 */
export const OPENCLAW_VERIFIED_VERSION = "2026.5.19";

/**
 * Date the verification ran (UTC ISO date). Surfaced in admin/audit so an
 * operator inspecting an RBAC decision knows how stale the pin is relative
 * to upstream.
 */
export const OPENCLAW_VERIFIED_AT = "2026-05-19";

/**
 * Resolves the openclaw install path — symlink chain from `which openclaw`
 * → package dir. Returns null if openclaw isn't installed in PATH.
 */
export function findInstalledOpenclawPackageDir(): string | null {
  try {
    const bin = execSync("readlink -f $(which openclaw)", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!bin) return null;
    return path.dirname(bin);
  } catch {
    return null;
  }
}

/**
 * Read the version of the actually-installed openclaw from its
 * package.json. Returns null if not found.
 */
export function readInstalledOpenclawVersion(): string | null {
  const dir = findInstalledOpenclawPackageDir();
  if (!dir) return null;
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      version?: string;
    };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

export interface OpenclawVersionCheckResult {
  /** Version string in `package.json`, or null if openclaw isn't installed. */
  installed: string | null;
  /** The pinned version this codebase was verified against. */
  expected: string;
  /** When the pin was last verified (ISO date). */
  verifiedAt: string;
  /** Match shape — exact, drift detected, or openclaw missing. */
  status: "match" | "drift" | "missing";
}

export function checkOpenclawVersion(): OpenclawVersionCheckResult {
  const installed = readInstalledOpenclawVersion();
  if (installed === null) {
    return {
      installed: null,
      expected: OPENCLAW_VERIFIED_VERSION,
      verifiedAt: OPENCLAW_VERIFIED_AT,
      status: "missing",
    };
  }
  return {
    installed,
    expected: OPENCLAW_VERIFIED_VERSION,
    verifiedAt: OPENCLAW_VERIFIED_AT,
    status: installed === OPENCLAW_VERIFIED_VERSION ? "match" : "drift",
  };
}

/**
 * One-shot sanity check used at portal boot. Logs a warning on drift so
 * operators see it in startup logs; doesn't throw, because local dev
 * routinely runs whatever's installed and we don't want to wedge boot.
 */
export function assertOpenclawVersionCompatible(): OpenclawVersionCheckResult {
  const r = checkOpenclawVersion();
  if (r.status === "drift") {
    console.warn(
      `[openclaw-pin] installed openclaw is ${r.installed}; FlatClaw was last verified against ${r.expected} (${r.verifiedAt}). RBAC/MCP behavior may differ. To pin: 'npm i -g openclaw@${r.expected}'.`,
    );
  } else if (r.status === "missing") {
    console.warn(
      `[openclaw-pin] openclaw not found on PATH. Expected ${r.expected}. Install: 'npm i -g openclaw@${r.expected}'.`,
    );
  }
  return r;
}
