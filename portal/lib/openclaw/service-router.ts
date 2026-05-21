/**
 * Heuristic service router (#5).
 *
 * Given a piece of text (typically the user's first message in a session),
 * predict which managed services the agent is likely to reach for. The
 * portal uses this to:
 *   - Stamp a per-session hint into the agent's context so the model
 *     knows where to start (without burning a discovery turn on `_help`)
 *   - Pre-warm the right subagent in subagents-mode (#2), or
 *   - Surface a "this session looks like X — enable Y?" UI affordance.
 *
 * Implementation: keyword maps with weighted matches. Deterministic, no
 * LLM hop. False positives are cheap (the model just doesn't end up using
 * the suggested service); false negatives just degrade to current
 * behavior (model has to discover via catalog `_help`).
 */
import type { SubagentService } from "./service-subagents";

/**
 * Per-service vocabulary. Keys: words/phrases that strongly imply the
 * service. Multi-word phrases are matched as substrings; single words
 * match on word boundaries.
 */
const SERVICE_KEYWORDS: Record<SubagentService, string[]> = {
  google: [
    // Gmail
    "gmail",
    "email",
    "inbox",
    "mailbox",
    "send mail",
    "draft",
    "reply",
    "forward",
    "unread",
    "thread",
    "starred",
    // Drive
    "drive",
    "folder",
    "google doc",
    "google sheet",
    "spreadsheet",
    "slides",
    "upload",
    "share with",
    // Calendar
    "calendar",
    "event",
    "meeting",
    "schedule",
    "free/busy",
    "freebusy",
    "rsvp",
    "invite",
    // Docs / Sheets
    "google docs",
    "google sheets",
    "row",
    "column",
    "cell",
    // Contacts / People
    "contact",
    "phone number",
    "address book",
  ],
  caldav: [
    "caldav",
    "carddav",
    "imap",
    "smtp",
    "mailbox",
    "icalendar",
    "ics",
    "vcard",
    "itip",
    "icloud calendar",
    "fastmail",
    "self-hosted email",
  ],
  cpanel: [
    "cpanel",
    "whm",
    "uapi",
    "dns record",
    "a record",
    "cname",
    "mx record",
    "txt record",
    "subdomain",
    "domain",
    "ssl",
    "letsencrypt",
    "let's encrypt",
    "certificate",
    "mysql",
    "phpmyadmin",
    "postgres",
    "ftp",
    "filezilla",
    "public_html",
    "wp-content",
    "wordpress",
    "php.ini",
    "htaccess",
    ".htaccess",
    "modsecurity",
    "cron job",
    "cronjob",
    "cron tab",
    "cpanel api",
    "hosting",
    "webmail account",
    "email account",
    "create email",
    "forwarder",
    "autoresponder",
    "spam filter",
  ],
  jira: [
    "jira",
    "atlassian",
    "issue",
    "ticket",
    "story",
    "epic",
    "sprint",
    "backlog",
    "kanban",
    "scrum",
    "board",
    "transition",
    "in progress",
    "to do",
    "done",
    "assignee",
    "worklog",
    "jql",
  ],
};

interface RouteHit {
  service: SubagentService;
  matches: string[];
  score: number;
}

/**
 * Score each service against the input. Returns services ranked by
 * confidence, omitting any with zero matches. Use the threshold knob to
 * filter weak signals.
 */
export function predictServices(
  text: string,
  opts: { minScore?: number } = {},
): RouteHit[] {
  const min = opts.minScore ?? 1;
  const lower = text.toLowerCase();
  const hits: RouteHit[] = [];
  for (const [service, vocab] of Object.entries(SERVICE_KEYWORDS) as Array<
    [SubagentService, string[]]
  >) {
    const matches: string[] = [];
    for (const term of vocab) {
      if (term.includes(" ")) {
        // multi-word: substring
        if (lower.includes(term)) matches.push(term);
      } else {
        // single word: boundary match (avoid "domain" matching "domainant")
        const re = new RegExp(`\\b${escapeRegex(term)}\\b`, "i");
        if (re.test(lower)) matches.push(term);
      }
    }
    if (matches.length >= min) {
      hits.push({ service, matches, score: matches.length });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

/**
 * Top services by predicted relevance, capped at `limit`. Convenience
 * wrapper around `predictServices` for callers that just want a list of
 * service identifiers.
 */
export function topServices(
  text: string,
  limit = 3,
  minScore = 1,
): SubagentService[] {
  return predictServices(text, { minScore })
    .slice(0, limit)
    .map((h) => h.service);
}

/**
 * Render a one-line agent hint suitable for injection into a session's
 * system context. Returns null when nothing strong enough was detected.
 *   "Hint: this looks like a `google` task (mentions: email, draft).
 *    Start with `google_help` to see available tools."
 */
export function renderServiceHint(text: string): string | null {
  const hits = predictServices(text, { minScore: 1 }).slice(0, 2);
  if (hits.length === 0) return null;
  const parts = hits.map((h) => {
    const sample = h.matches.slice(0, 3).join(", ");
    return `${h.service} (mentions: ${sample})`;
  });
  return `Likely services for this session: ${parts.join("; ")}. Start with \`<service>_help\` to discover tools without burning context.`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
