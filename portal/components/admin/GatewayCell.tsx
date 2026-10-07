import { PendingButton } from "@/components/PendingButton";

export interface GatewayRow {
  agentId: string;
  port: number;
  unixUser: string | null;
  state: "running" | "stopped";
  pid: number | null;
  uptimeMs: number | null;
  restarts: number;
  reachable: boolean;
  error: string | null;
}

export function formatUptime(ms: number | null): string {
  if (ms === null) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

/**
 * One user's gateway in the admin users table (per-user mode): where it
 * listens, as whom it runs, whether it is up, and start / stop / restart.
 * `action` is the page's server action; it reads `agentId` and `action`.
 */
export function GatewayCell({
  gateway,
  action,
  compact = true,
}: {
  gateway: GatewayRow | null;
  action: (formData: FormData) => Promise<void>;
  compact?: boolean;
}) {
  if (!gateway) {
    return <span className="text-xs opacity-60">no gateway yet</span>;
  }
  const up = gateway.state === "running" && gateway.reachable;
  const buttonClass = "fc-btn fc-btn-sm fc-btn-secondary capitalize";
  return (
    <div className={compact ? "flex flex-col gap-1" : "flex flex-col gap-2"}>
      <div className="flex items-center gap-2 text-xs">
        <span
          className={
            "fc-chip " + (up ? "" : gateway.state === "running" ? "!text-amber-700" : "!text-red-700")
          }
        >
          <span
            className={
              "inline-block h-1.5 w-1.5 rounded-full " +
              (up ? "bg-[hsl(var(--brand-accent))]" : gateway.state === "running" ? "bg-amber-500" : "bg-red-500")
            }
          />
          {up ? "running" : gateway.state === "running" ? "starting" : "stopped"}
        </span>
        <code className="font-mono text-[hsl(var(--fc-fg-muted))]">:{gateway.port}</code>
        {gateway.unixUser && <code className="font-mono text-[hsl(var(--fc-fg-muted))]">{gateway.unixUser}</code>}
        {gateway.uptimeMs !== null && <span className="text-[hsl(var(--fc-fg-muted))]">{formatUptime(gateway.uptimeMs)}</span>}
        {gateway.restarts > 0 && <span className="text-amber-600">{gateway.restarts} restart{gateway.restarts === 1 ? "" : "s"}</span>}
      </div>
      {gateway.error && <div className="text-[11px] text-red-600 font-mono break-words">{gateway.error}</div>}
      <div className="flex items-center gap-1.5">
        {(["start", "stop", "restart"] as const).map((a) => (
          <form key={a} action={action}>
            <input type="hidden" name="agentId" value={gateway.agentId} />
            <input type="hidden" name="action" value={a} />
            <PendingButton pendingLabel="…" className={buttonClass}>
              {a}
            </PendingButton>
          </form>
        ))}
      </div>
    </div>
  );
}
