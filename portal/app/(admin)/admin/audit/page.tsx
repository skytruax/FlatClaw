import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db, schema } from "@/lib/db/client";
import { desc, eq, like } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import Link from "next/link";

export const dynamic = "force-dynamic";

const MAX_ROWS = 200;

type FilterKey = "all" | "tool-policy" | "other";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "tool-policy", label: "Tool policy" },
  { key: "other", label: "Other" },
];

function isToolPolicy(action: string): boolean {
  return action.startsWith("tool-policy.");
}

/**
 * Render the metadata JSON compactly. Tool-policy decisions get a
 * structured rendering (service / role / toolName / reason); everything
 * else falls back to a one-line key=value dump.
 */
function MetadataCell({
  action,
  metadata,
}: {
  action: string;
  metadata: unknown;
}) {
  if (metadata == null) {
    return <span className="text-[hsl(var(--fc-fg-muted))]">—</span>;
  }

  if (
    isToolPolicy(action) &&
    typeof metadata === "object" &&
    !Array.isArray(metadata)
  ) {
    const m = metadata as Record<string, unknown>;
    const fields: { label: string; value: unknown }[] = [
      { label: "service", value: m.service },
      { label: "role", value: m.role },
      { label: "tool", value: m.toolName },
      { label: "reason", value: m.reason },
    ].filter((f) => f.value != null && f.value !== "");
    if (fields.length > 0) {
      return (
        <div className="flex flex-col gap-0.5 text-xs">
          {fields.map((f) => (
            <div key={f.label} className="flex gap-1.5">
              <span className="text-[hsl(var(--fc-fg-muted))] w-14 shrink-0">
                {f.label}
              </span>
              <span
                className={
                  f.label === "reason"
                    ? "text-[hsl(var(--fc-fg-secondary))] break-words"
                    : "font-mono text-[hsl(var(--fc-fg-primary))] break-all"
                }
              >
                {String(f.value)}
              </span>
            </div>
          ))}
        </div>
      );
    }
  }

  // Fallback: compact one-line key=value rendering for objects, raw JSON
  // otherwise.
  let text: string;
  if (typeof metadata === "object" && !Array.isArray(metadata)) {
    text = Object.entries(metadata as Record<string, unknown>)
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join("  ");
  } else {
    text = JSON.stringify(metadata);
  }
  return (
    <span className="font-mono text-xs text-[hsl(var(--fc-fg-secondary))] break-all">
      {text}
    </span>
  );
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/me/chat");

  const sp = (await searchParams) ?? {};
  const rawFilter = typeof sp.filter === "string" ? sp.filter : "all";
  const filter: FilterKey = FILTERS.some((f) => f.key === rawFilter)
    ? (rawFilter as FilterKey)
    : "all";

  // Join the users table twice: once for the actor, once for the (optional)
  // target. Using aliases keeps the two joins distinct.
  const actor = alias(schema.users, "actor");
  const target = alias(schema.users, "target");

  let query = db
    .select({
      id: schema.auditLog.id,
      action: schema.auditLog.action,
      ts: schema.auditLog.ts,
      metadata: schema.auditLog.metadata,
      actorUserId: schema.auditLog.actorUserId,
      actorEmail: actor.email,
      targetUserId: schema.auditLog.targetUserId,
      targetEmail: target.email,
    })
    .from(schema.auditLog)
    .leftJoin(actor, eq(schema.auditLog.actorUserId, actor.id))
    .leftJoin(target, eq(schema.auditLog.targetUserId, target.id))
    .$dynamic();

  // "tool-policy" filters by action prefix server-side. "other" can't be
  // expressed as a single SQL predicate cleanly across all non-tool-policy
  // actions, so we over-fetch and filter in memory below.
  if (filter === "tool-policy") {
    query = query.where(like(schema.auditLog.action, "tool-policy.%"));
  }

  let rows = await query.orderBy(desc(schema.auditLog.ts)).limit(MAX_ROWS);

  if (filter === "other") {
    rows = rows.filter((r) => !isToolPolicy(r.action));
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <span className="text-sm text-[hsl(var(--fc-fg-muted))]">
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
          {rows.length >= MAX_ROWS ? ` (latest ${MAX_ROWS})` : ""}
        </span>
      </div>

      <nav className="flex items-center gap-1 mb-4 text-sm">
        {FILTERS.map((f) => {
          const active = f.key === filter;
          const href = f.key === "all" ? "/admin/audit" : `/admin/audit?filter=${f.key}`;
          return (
            <Link
              key={f.key}
              href={href}
              className={
                "rounded px-3 py-1 " +
                (active
                  ? "bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] font-medium"
                  : "bg-[hsl(var(--fc-bg-surface))] text-[hsl(var(--fc-fg-secondary))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] hover:bg-[hsl(var(--fc-bg-tertiary))]")
              }
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <div className="rounded-lg bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-4 text-sm text-[hsl(var(--fc-fg-muted))]">
          No audit entries{filter !== "all" ? ` for filter "${filter}"` : ""} yet.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-[hsl(var(--fc-fg-muted))]">
            <tr>
              <th className="px-3 py-2 font-medium whitespace-nowrap">When</th>
              <th className="px-3 py-2 font-medium">Actor</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Target</th>
              <th className="px-3 py-2 font-medium">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const deny = r.action === "tool-policy.deny";
              const allow = r.action === "tool-policy.allow";
              return (
                <tr
                  key={r.id}
                  className={
                    "border-t border-[hsl(var(--fc-bg-tertiary))] align-top " +
                    (deny ? "bg-red-50/60" : "")
                  }
                >
                  <td className="px-3 py-2.5 text-[hsl(var(--fc-fg-muted))] whitespace-nowrap">
                    {r.ts ? new Date(r.ts).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.actorEmail ? (
                      <span className="text-[hsl(var(--fc-fg-secondary))]">
                        {r.actorEmail}
                      </span>
                    ) : (
                      <code className="font-mono text-xs text-[hsl(var(--fc-fg-muted))]">
                        {r.actorUserId}
                      </code>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={
                        "rounded px-2 py-0.5 text-xs font-medium " +
                        (deny
                          ? "bg-red-100 text-red-700"
                          : allow
                            ? "bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-muted))]"
                            : "bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-secondary))]")
                      }
                    >
                      {r.action}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.targetUserId ? (
                      r.targetEmail ? (
                        <span className="text-[hsl(var(--fc-fg-secondary))]">
                          {r.targetEmail}
                        </span>
                      ) : (
                        <code className="font-mono text-xs text-[hsl(var(--fc-fg-muted))]">
                          {r.targetUserId}
                        </code>
                      )
                    ) : (
                      <span className="text-[hsl(var(--fc-fg-muted))]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <MetadataCell action={r.action} metadata={r.metadata} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
