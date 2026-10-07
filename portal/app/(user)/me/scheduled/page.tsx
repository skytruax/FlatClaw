import { requireUser } from "@/lib/auth/guards";
import ScheduledTasksPanel from "@/components/scheduler/ScheduledTasksPanel";
import { PageHeader } from "@/components/shell/PageHeader";

export const dynamic = "force-dynamic";

export default async function ScheduledTasksPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        eyebrow="Automation"
        title="Scheduled tasks"
        description="Tell your agent to do something once or on a recurring schedule. Each run happens in its own session."
      />
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <ScheduledTasksPanel chatLinkBase="/me/chat" />
      </div>
    </>
  );
}
