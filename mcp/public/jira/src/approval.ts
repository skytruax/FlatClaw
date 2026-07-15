/**
 * Approval-gating for consequential Jira writes — the same human-approval
 * plumbing the newer demo services established, generalized for a per-user
 * credentialed service.
 *
 * Tools listed in `JIRA_APPROVAL_TOOLS` (comma-separated; default
 * "delete_attachment") are never executed by the agent. The tool handler runs
 * with the API client in compose mode: reads pass through, and the first
 * mutating REST call is CAPTURED and returned as a PENDING_HUMAN_APPROVAL
 * envelope (the shape the portal approvals queue consumes). On human approval
 * the portal replays the captured request against the user's own workspace
 * with vault credentials (portal services/jira/execute.ts). The composed
 * request carries no credentials.
 */

export const SERVICE = "jira";

/** Destructive by default; operators extend via FLATCLAW_JIRA_APPROVAL_TOOLS. */
export const DEFAULT_APPROVAL_TOOLS = ["delete_attachment"] as const;

export function parseApprovalTools(raw: string | undefined): Set<string> {
  if (raw === undefined) return new Set<string>(DEFAULT_APPROVAL_TOOLS);
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** A captured mutating REST call. */
export interface ComposedRest {
  method: string;
  url: string;
  json?: unknown;
}

/**
 * Thrown by the client in compose mode to abort the handler at the mutation
 * point. Handlers that convert errors into tool results may swallow it — the
 * wrapper in index.ts therefore reads the capture back off the client rather
 * than relying on this propagating.
 */
export class ComposedMutation extends Error {
  constructor(public readonly composed: ComposedRest) {
    super("composed mutation captured for human approval");
    this.name = "ComposedMutation";
  }
}

/** The PENDING_HUMAN_APPROVAL tool result for a captured mutation. */
export function pendingApprovalResult(opts: {
  tool: string;
  args: unknown;
  composed: ComposedRest;
}) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            action: opts.tool,
            status: "PENDING_HUMAN_APPROVAL",
            executed: false,
            approval: {
              kind: opts.tool,
              // Must match the portal ManagedMcpService id so the queue's
              // executeApproval hook resolves.
              service: SERVICE,
              title: `Jira ${opts.tool.replace(/_/g, " ")}`,
              requestedByAgentId: process.env.OPENCLAW_AGENT_ID ?? undefined,
              approverPolicy: { mode: "self" as const },
            },
            composedRequest: { tool: opts.tool, args: opts.args, ...opts.composed },
            notice:
              "This action is composed but NOT executed. It requires human sign-off in the FlatClaw approvals queue; the approver and this composed request are recorded in the audit log. You cannot complete it autonomously.",
          },
          null,
          2,
        ),
      },
    ],
  };
}
