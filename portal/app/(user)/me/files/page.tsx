import { loadUser, requireUser } from "@/lib/auth/guards";
import FileExplorer from "@/components/files/FileExplorer";
import { PageHeader } from "@/components/shell/PageHeader";

export const dynamic = "force-dynamic";

/** The signed-in user's workspace: what their agent reads and writes. */
export default async function FilesPage() {
  const me = await requireUser();
  const user = await loadUser(me.id);
  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Files"
        description="Everything your agent reads and writes lives here. Upload a file to hand it over, download what it produced, or tidy up."
      />
      <div className="mx-auto max-w-6xl p-6">
        {user?.agentId ? (
          <FileExplorer agentId={user.agentId} targetUserId={user.id} className="h-[68vh] min-h-[420px] w-full" />
        ) : (
          <div className="fc-card p-6 text-sm text-[hsl(var(--fc-fg-secondary))]">
            This account has no agent yet, so there is no workspace to show.
          </div>
        )}
      </div>
    </>
  );
}
