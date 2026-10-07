import { requireUser } from "@/lib/auth/guards";
import { signOut } from "@/lib/auth/config";
import { AppHeader } from "@/components/shell/AppHeader";
import { AppFooter } from "@/components/shell/AppFooter";

export default async function MeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireUser();

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        homeHref="/me/chat"
        email={me.email}
        logout={logout}
        links={[
          { href: "/me/chat", label: "Chat" },
          { href: "/me/scheduled", label: "Scheduled" },
          { href: "/me/files", label: "Files" },
          ...(me.role === "admin" ? [{ href: "/admin/users", label: "Admin" }] : []),
        ]}
      />
      <main className="flex flex-1 flex-col overflow-auto bg-[hsl(var(--fc-bg-primary))] text-[hsl(var(--fc-fg-primary))]">
        {/* A plain block (not a flex column): centred pages keep their width, and the chat page can fill the height. */}
        <div className="min-h-0 flex-1">{children}</div>
        <AppFooter />
      </main>
    </div>
  );
}
