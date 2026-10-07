import { requireAdmin } from "@/lib/auth/guards";
import { signOut } from "@/lib/auth/config";
import { AppHeader } from "@/components/shell/AppHeader";
import { AppFooter } from "@/components/shell/AppFooter";

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
    <div className="flex h-full flex-col">
      <AppHeader
        homeHref="/admin/users"
        badge="Admin"
        email={me.email}
        logout={logout}
        links={[
          { href: "/admin/users", label: "Users" },
          { href: "/admin/settings/oauth-apps", label: "OAuth apps" },
          { href: "/admin/audit", label: "Audit log" },
          { href: "/admin/settings", label: "Settings" },
        ]}
      />
      <main className="flex flex-1 flex-col overflow-auto bg-[hsl(var(--fc-bg-primary))] text-[hsl(var(--fc-fg-primary))]">
        <div className="flex-1">{children}</div>
        <AppFooter />
      </main>
    </div>
  );
}
