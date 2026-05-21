import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";

let seeded = false;

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
