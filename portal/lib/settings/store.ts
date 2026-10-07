/**
 * Key/value settings the portal owns (table `portal_settings`). Synchronous
 * on purpose: better-sqlite3 is synchronous, and the readers (model lists,
 * the gateway supervisor) run in places that cannot await.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

export function getSetting(key: string): string | null {
  const row = db.select().from(schema.portalSettings).where(eq(schema.portalSettings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null): void {
  if (value === null) {
    db.delete(schema.portalSettings).where(eq(schema.portalSettings.key, key)).run();
    return;
  }
  db.insert(schema.portalSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.portalSettings.key, set: { value, updatedAt: new Date() } })
    .run();
}
