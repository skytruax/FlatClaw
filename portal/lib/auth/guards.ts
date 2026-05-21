import { auth } from "./config";
import { redirect } from "next/navigation";
import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";
import type { User } from "../db/schema";

export async function requireSession(): Promise<{
  id: string;
  email: string;
  role: "admin" | "user";
}> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return {
    id: session.user.id,
    email: session.user.email,
    role: session.user.role,
  };
}

export async function requireAdmin() {
  const me = await requireSession();
  if (me.role !== "admin") redirect("/me/chat");
  return me;
}

export async function requireUser() {
  return requireSession();
}

export async function loadUser(id: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  return rows[0] ?? null;
}
