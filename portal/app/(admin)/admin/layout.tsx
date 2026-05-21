import { requireAdmin } from "@/lib/auth/guards";
import { signOut } from "@/lib/auth/config";
import Link from "next/link";
import Image from "next/image";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireAdmin();

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between bg-[hsl(var(--brand-primary))] px-6 py-3 text-white">
        <div className="flex items-center gap-6">
          <Link href="/admin/users" className="flex items-center" aria-label="FlatClaw">
            <Image
              src="/branding/wordmark-white.svg"
              alt="FlatClaw"
              width={130}
              height={28}
              priority
            />
          </Link>
          <nav className="flex items-center gap-4 text-sm opacity-90">
            <Link href="/admin/users" className="hover:opacity-100">
              Users
            </Link>
            <Link href="/admin/settings/oauth-apps" className="hover:opacity-100">
              OAuth apps
            </Link>
            <Link href="/admin/audit" className="hover:opacity-100">
              Audit log
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="opacity-80">{me.email}</span>
          <form action={logout}>
            <button className="rounded bg-white/10 px-3 py-1 text-xs hover:bg-white/20">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 overflow-auto bg-[hsl(var(--fc-bg-primary))] text-[hsl(var(--fc-fg-primary))]">
        {children}
      </main>
    </div>
  );
}
