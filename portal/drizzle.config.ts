import type { Config } from "drizzle-kit";
import { homedir } from "node:os";

const dbPath =
  process.env.PORTAL_DB_PATH ?? `${homedir()}/.openclaw-portal/portal.db`;

export default {
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "sqlite",
  dbCredentials: { url: dbPath },
} satisfies Config;
