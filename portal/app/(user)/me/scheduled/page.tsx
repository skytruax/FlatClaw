import { requireUser } from "@/lib/auth/guards";
import ScheduledTasksPanel from "@/components/scheduler/ScheduledTasksPanel";

export const dynamic = "force-dynamic";

export default async function ScheduledTasksPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Scheduled tasks</h1>
        <p className="text-sm text-[hsl(var(--fc-fg-muted))]">
          Tell your agent to do something once or on a recurring schedule.
        </p>
      </div>
      <ScheduledTasksPanel chatLinkBase="/me/chat" />
    </div>
  );
}
