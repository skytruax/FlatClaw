/**
 * FlatClaw demo prep — create cpanel resources for the
 * Bramble & Co customer-dashboard demo.
 *
 * Idempotent: safe to re-run (existing dbs / users are skipped, file is
 * overwritten).
 *
 * What it does, against Skyler's flatclaw.org cpanel:
 *   1. creates two MySQL databases — `<prefix>_flatclaw_demo_basic`
 *      and `<prefix>_flatclaw_demo_enriched`
 *   2. creates one MySQL user — `<prefix>_flatclaw_demo` — with a stable
 *      password (from FLATCLAW_DEMO_DB_PASS env, or auto-generated and
 *      printed once for you to record)
 *   3. grants ALL PRIVILEGES on both databases to that user
 *   4. uploads `index.php` to `~/public_html/demo/index.php` (creating
 *      the directory if needed) with the right credentials baked in
 *
 * The PHP file then self-seeds tables + fake data on first hit per phase.
 *
 * Usage:
 *   pnpm tsx scripts/demo/setup-cpanel-demo.ts
 *
 * Optional env:
 *   FLATCLAW_DEMO_DB_PASS  — pin the demo MySQL password (else auto)
 *   FLATCLAW_DEMO_USER_EMAIL — which FlatClaw user owns the cpanel
 *                              creds we'll act through (default skyler@flatclaw.org)
 */
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto/aes-gcm";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import * as https from "node:https";

const PHP_SOURCE = path.resolve(
  __dirname,
  "../../../scripts/demo/index.php",
);
const REMOTE_DIR = "/public_html/demo";
const REMOTE_FILE = "index.php";

const BASIC_DB_SHORT = "flatclaw_demo_basic";
const ENRICHED_DB_SHORT = "flatclaw_demo_enriched";
const USER_SHORT = "flatclaw_demo";

interface CpanelCreds {
  username: string;
  apiToken: string;
  serverUrl: string;
  verifySsl: boolean;
}

interface UapiResponse<T = unknown> {
  status: number;
  errors: string[] | null;
  messages: string[] | null;
  data: T;
}

async function loadCreds(email: string): Promise<CpanelCreds> {
  const u = (
    await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1)
  )[0];
  if (!u) throw new Error(`no portal user with email ${email}`);
  const cred = (
    await db
      .select()
      .from(schema.cpanelCredentials)
      .where(eq(schema.cpanelCredentials.userId, u.id))
      .limit(1)
  )[0];
  if (!cred) throw new Error(`user ${email} has no cpanel credentials in vault`);
  const apiToken = decrypt(
    {
      ciphertext: cred.apiTokenCipher,
      iv: cred.iv,
      authTag: cred.authTag,
    },
    `cpanel-credential:${u.id}`,
  );
  return {
    username: cred.username,
    apiToken,
    serverUrl: cred.serverUrl.replace(/\/+$/, ""),
    verifySsl: cred.verifySsl,
  };
}

async function uapi<T = unknown>(
  creds: CpanelCreds,
  method: "GET" | "POST",
  module: string,
  fn: string,
  params: Record<string, string>,
): Promise<UapiResponse<T>> {
  const url = new URL(`${creds.serverUrl}/execute/${module}/${fn}`);
  const headers: Record<string, string> = {
    Authorization: `cpanel ${creds.username}:${creds.apiToken}`,
    Accept: "application/json",
  };
  let body: string | undefined;
  if (method === "POST") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(params).toString();
  } else {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  // Reuse a single agent; honor verifySsl flag.
  const agent = new https.Agent({ rejectUnauthorized: creds.verifySsl });
  const res = await fetch(url.toString(), {
    method,
    headers,
    body,
    // @ts-expect-error — Node's fetch supports `dispatcher`/`agent` via opts.
    agent,
  });
  const text = await res.text();
  let parsed: UapiResponse<T>;
  try {
    parsed = JSON.parse(text) as UapiResponse<T>;
  } catch {
    throw new Error(
      `${module}.${fn}: non-JSON response (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  if (parsed.status !== 1 || (parsed.errors && parsed.errors.length > 0)) {
    const err = parsed.errors?.join("; ") ?? "unknown UAPI error";
    throw new Error(`${module}.${fn}: ${err}`);
  }
  return parsed;
}

function log(...args: unknown[]) {
  console.log("[demo-setup]", ...args);
}

async function main() {
  const userEmail =
    process.env.FLATCLAW_DEMO_USER_EMAIL ?? "skyler@flatclaw.org";
  const creds = await loadCreds(userEmail);
  const prefix = creds.username; // cpanel db/user prefix is the account name
  const basicDb = `${prefix}_${BASIC_DB_SHORT}`;
  const enrichedDb = `${prefix}_${ENRICHED_DB_SHORT}`;
  const dbUser = `${prefix}_${USER_SHORT}`;
  const dbPass =
    process.env.FLATCLAW_DEMO_DB_PASS ??
    randomBytes(18).toString("base64").replace(/[+/=]/g, "").slice(0, 24);

  log("acting as cpanel user:", creds.username, "@", creds.serverUrl);
  log("planned resources:");
  log("  db (basic)   :", basicDb);
  log("  db (enriched):", enrichedDb);
  log("  mysql user   :", dbUser);
  log("  password     : (will be embedded in index.php — also printed at end)");

  // 1. Existing-state check
  const dbList = await uapi<string[]>(creds, "GET", "Mysql", "list_databases", {});
  const existing = new Set((dbList.data ?? []).map((d) => (d as { database?: string }).database ?? d as unknown as string));
  log("existing databases:", existing.size, "found");

  // 2. Create dbs (skip if already there). cpanel UAPI on this server
  // requires the FULL prefixed name (it validates the prefix matches the
  // calling account); other deployments auto-prefix — pass full either way.
  for (const dbName of [basicDb, enrichedDb]) {
    if (existing.has(dbName)) {
      log("db already exists, skipping:", dbName);
    } else {
      await uapi(creds, "POST", "Mysql", "create_database", {
        name: dbName,
      });
      log("created db:", dbName);
    }
  }

  // 3. Create user (skip if already there). Same prefix rule.
  const userList = await uapi<unknown[]>(creds, "GET", "Mysql", "list_users", {});
  const userExists = (userList.data ?? []).some(
    (u) => (u as { user?: string })?.user === dbUser,
  );
  if (userExists) {
    log("mysql user already exists, skipping create:", dbUser);
    log(
      "  (if you don't have the password, set FLATCLAW_DEMO_DB_PASS and re-run, or delete the user via cpanel and re-run)",
    );
  } else {
    await uapi(creds, "POST", "Mysql", "create_user", {
      name: dbUser,
      password: dbPass,
    });
    log("created mysql user:", dbUser);
  }

  // 4. Grant privileges on both dbs (idempotent)
  for (const dbName of [basicDb, enrichedDb]) {
    await uapi(creds, "POST", "Mysql", "set_privileges_on_database", {
      user: dbUser,
      database: dbName,
      privileges: "ALL PRIVILEGES",
    });
    log("granted ALL on", dbName, "to", dbUser);
  }

  // 5. Read PHP source, substitute placeholders
  let php = readFileSync(PHP_SOURCE, "utf8");
  php = php.replaceAll("__DB_BASIC__", basicDb);
  php = php.replaceAll("__DB_ENRICHED__", enrichedDb);
  php = php.replaceAll("__DB_USER__", dbUser);
  php = php.replaceAll("__DB_PASS__", dbPass);

  // 6. Ensure remote dir exists (Fileman::mkdir is idempotent enough — errors swallowed)
  try {
    await uapi(creds, "POST", "Fileman", "mkdir", {
      path: "/public_html",
      name: "demo",
    });
    log("created", REMOTE_DIR);
  } catch (err) {
    log("mkdir public_html/demo (likely already exists):", String(err).slice(0, 100));
  }

  // 7. Upload PHP via save_file_content
  await uapi(creds, "POST", "Fileman", "save_file_content", {
    dir: REMOTE_DIR,
    file: REMOTE_FILE,
    content: php,
    fallback: "0",
    from_charset: "utf-8",
    to_charset: "utf-8",
  });
  log("uploaded", `${REMOTE_DIR}/${REMOTE_FILE}`, `(${php.length} bytes)`);

  log("");
  log("=========================================================");
  log("demo prep complete");
  log("=========================================================");
  log("public URL  :", `https://flatclaw.org/demo/`);
  log("db basic    :", basicDb);
  log("db enriched :", enrichedDb);
  log("mysql user  :", dbUser);
  log("mysql pass  :", dbPass, "(record this — it's now baked into the PHP file)");
  log("");
  log("First load will self-seed Phase-1 tables + fake data.");
  log("During the demo: agent edits the 3 constants at the top of");
  log("the PHP file via cpanel.edit_file → Phase 2 dashboard renders.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[demo-setup] failed:", err);
    process.exit(1);
  });
