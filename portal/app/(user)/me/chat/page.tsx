import Link from "next/link";
import { loadUser, requireUser } from "@/lib/auth/guards";
import ChatPanel from "@/components/chat/ChatPanel";
import { SidebarTabs } from "@/components/sidebar/SidebarTabs";

export const dynamic = "force-dynamic";

/**
 * A user's own workspace: their sessions and files on the left, the
 * conversation with their agent on the right. The same components the admin
 * sees under "Chat as", scoped by every API route to the signed-in user's own
 * agent (a non-admin cannot name another one).
 */
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireUser();
  const user = await loadUser(me.id);
  const sp = await searchParams;

  if (!user?.agentId) {
    return (
      <div className="mx-auto max-w-2xl p-6 pt-10">
        <div className="fc-card p-6">
          <div className="fc-eyebrow mb-2">Chat</div>
          <h1 className="fc-title text-xl">
            {me.role === "admin" ? "This account has no agent of its own" : "Your agent is not set up yet"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">
            {me.role === "admin" ? (
              <>
                Administrators manage users and chat as them from{" "}
                <Link href="/admin/users" className="font-medium text-[hsl(var(--brand-accent-deep))] hover:underline">
                  Admin → Users
                </Link>
                .
              </>
            ) : (
              "Your administrator has created your account but your agent is still being provisioned. Try again in a minute, or ask them to open your user page and choose Provision agent."
            )}
          </p>
        </div>
      </div>
    );
  }

  const requested = typeof sp.session === "string" ? sp.session : undefined;
  // Only this agent's sessions can be opened here; anything else falls back to main.
  const activeSessionKey =
    requested && requested.startsWith(`agent:${user.agentId}:`) ? requested : `agent:${user.agentId}:main`;

  return (
    <div className="mx-auto grid h-full min-h-[560px] w-full max-w-[1500px] grid-cols-1 gap-4 p-4 lg:grid-cols-[340px_1fr]">
      <SidebarTabs
        agentId={user.agentId}
        targetUserId={user.id}
        activeSessionKey={activeSessionKey}
        className="hidden h-full min-h-0 lg:flex"
      />
      <ChatPanel
        targetUserId={user.id}
        agentId={user.agentId}
        identityName={user.identityName ?? user.email}
        sessionKey={activeSessionKey}
        className="h-full min-h-[520px]"
        own
      />
    </div>
  );
}
