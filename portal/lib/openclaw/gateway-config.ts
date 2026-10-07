import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { getGatewayClient, type OpenClawClient } from "./adapter";
import {
  normalizeAgentRoster,
  type ConfigBlob,
  type McpServerEntry,
} from "./agent-roster";

/**
 * Read-modify-write access to the gateway's config document.
 *
 * Every portal config writer does the same three things: `config.get`, mutate
 * the document in JS, then send the WHOLE document back with
 * `config.set {raw, baseHash}`. This module is the one place that knows how.
 *
 * Why it is centralized:
 *
 *   - A full-document write built from a document we failed to read replaces
 *     openclaw.json with a near-empty file. `readGatewayConfig` throws instead
 *     of handing back `{}`.
 *   - The write is built from the AUTHORED document (`raw`, or `parsed` when
 *     the gateway withholds `raw`), not from `config`. `config` is the
 *     gateway's runtime view: defaults are materialized into it and `${ENV}`
 *     references are resolved, so "is this key set?" cannot be answered from
 *     it and writing it back would bake both in.
 *   - The roster shape (`agents.entries`, see agent-roster.ts) is normalized
 *     once here.
 *
 * Secrets: `config.get` returns secret values replaced by a redaction
 * sentinel, and `config.set` restores a sentinel from the stored value. So a
 * round trip leaves every secret we did not touch intact — but it also means a
 * secret read back from here is NOT its real value; never copy one out of the
 * document. Since openclaw 2026.9 that covers MCP `env` values too.
 */

export const REDACTED_SENTINEL = "__OPENCLAW_REDACTED__";

interface ConfigGetResult {
  /**
   * The config file text as stored, secrets redacted. Null when the config is
   * invalid, and also whenever the gateway cannot redact the text in a way it
   * could safely restore — then `parsed` is the authored document.
   */
  raw?: string | null;
  /** The authored document, parsed, secrets redacted. */
  parsed?: ConfigBlob | null;
  /** The gateway's runtime view (defaults materialized); `{}` when invalid. */
  config?: ConfigBlob | string;
  /** False when the stored config fails validation — contents are withheld. */
  valid?: boolean;
  hash?: string;
  baseHash?: string;
}

export interface GatewayConfigSnapshot<T extends ConfigBlob = ConfigBlob> {
  /** The authored config document. Mutate it, then call `writeGatewayConfig`. */
  blob: T;
  /** Optimistic-concurrency token: a write from a stale read is rejected. */
  hash: string | undefined;
  /** The document as read, serialized — the no-op check compares against it. */
  before: string;
}

function parseDocument(result: ConfigGetResult): ConfigBlob {
  if (result.valid === false) {
    // The gateway withholds an invalid config (`raw: null`, `config: {}`), so
    // anything written from this read would overwrite the real file with a
    // near-empty one.
    throw new Error(
      "the gateway reports its config as invalid and withholds its contents — repair it (`openclaw doctor --fix`) before the portal writes config",
    );
  }
  const hasParsed = !!result.parsed && typeof result.parsed === "object";
  if (typeof result.raw === "string" && result.raw.trim()) {
    try {
      return JSON.parse(result.raw) as ConfigBlob;
    } catch (err) {
      // A hand-edited file can be JSON5 (comments, trailing commas). `parsed`
      // below is the same document minus the formatting.
      if (!hasParsed && (result.config === undefined || result.config === null)) {
        throw new Error(
          `config.get returned a raw document that is not strict JSON and no parsed view to fall back on: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
  if (hasParsed) {
    return JSON.parse(JSON.stringify(result.parsed)) as ConfigBlob;
  }
  if (typeof result.config === "string") {
    return JSON.parse(result.config) as ConfigBlob;
  }
  if (result.config && typeof result.config === "object") {
    return JSON.parse(JSON.stringify(result.config)) as ConfigBlob;
  }
  throw new Error(
    "config.get returned neither `raw` nor `config` — refusing to build a config write from an empty document",
  );
}

/** Read the gateway config for a read-modify-write cycle (or a plain read). */
export async function readGatewayConfig<T extends ConfigBlob = ConfigBlob>(
  client: OpenClawClient = getGatewayClient(),
): Promise<GatewayConfigSnapshot<T>> {
  const result = (await client.call("config.get", {})) as ConfigGetResult;
  const blob = parseDocument(result ?? {});
  normalizeAgentRoster(blob);
  return {
    blob: blob as T,
    hash: result.hash ?? result.baseHash,
    before: JSON.stringify(blob),
  };
}

/**
 * Persist a snapshot the caller has mutated. Skips the gateway round trip (and
 * the reload it triggers) when nothing changed. Resolves once the gateway is
 * answering again. Returns whether a write happened.
 */
export async function writeGatewayConfig(
  snapshot: GatewayConfigSnapshot,
  client: OpenClawClient = getGatewayClient(),
): Promise<boolean> {
  const after = JSON.stringify(snapshot.blob);
  if (after === snapshot.before) return false;
  await client.call("config.set", { raw: after, baseHash: snapshot.hash });
  await client.waitUntilReady();
  return true;
}

/** Path of the gateway's config file on this host (portal and gateway share it). */
export function gatewayConfigFilePath(): string {
  return process.env.PORTAL_OPENCLAW_CONFIG ?? `${homedir()}/.openclaw/openclaw.json`;
}

/** JSON with object keys sorted, so key order never makes two entries differ. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Whether the config file on disk already holds exactly `desired` for an MCP
 * server. This is the only way to tell: the same entry read through
 * `config.get` has its `env` / `headers` values redacted. Reads the file
 * directly, like the gateway token lookup in adapter.ts does. When the file
 * cannot be read or compared the answer is "no", which costs one redundant
 * write rather than a stale entry.
 */
export function storedMcpServerEntryEquals(
  serverName: string,
  desired: McpServerEntry,
): boolean {
  const path = gatewayConfigFilePath();
  try {
    const onDisk = JSON.parse(readFileSync(path, "utf8")) as ConfigBlob;
    const stored = onDisk.mcp?.servers?.[serverName];
    return stored !== undefined && canonicalJson(stored) === canonicalJson(desired);
  } catch (err) {
    console.warn(
      `[gateway-config] could not compare MCP server "${serverName}" against ${path}; rewriting it:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
