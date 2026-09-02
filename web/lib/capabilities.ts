// The kinds of work the platform runs, each backed by real (anonymized)
// spotlights. Rendered on the home page as the "what you can run on it" grid.

export interface Capability {
  id: string;
  title: string;
  /** One sentence: what this family of work looks like on the platform. */
  body: string;
  /** Spotlight ids that prove it. Order matters; the first two are shown. */
  spotlights: string[];
  /** Featured family: full-width tile, four spotlights, a stats row. */
  featured?: boolean;
  stats?: [string, string][];
}

export const CAPABILITIES: Capability[] = [
  {
    id: "estimating",
    title: "Estimating and quoting from drawings, specs and history",
    body: "Takeoffs counted from the drawings' own data, reconciled against the team's proposal, priced on the company's rules, and benchmarked against what past jobs actually cost. Estimators steer in plain language; the final number waits for a human.",
    spotlights: ["drawing-takeoff", "erp-consolidation", "estimation-benchmarks", "logistics-tower"],
    featured: true,
    stats: [
      ["190", "drawing sheets read on one bid"],
      ["1,045", "units itemized, 36 equipment families"],
      ["88 · 216", "chillers and CRAHs, matching the estimators' count"],
      ["161 vs 280", "the spread surfaced for adjudication"],
    ],
  },
  {
    id: "voice",
    title: "Voice agents on your own lines",
    body: "Two-way phone agents that work a voicemail queue, take an intake call, or answer a front-line number, with the speech, the reasoning and the recordings all inside your tenancy.",
    spotlights: ["voicemail-lane"],
  },
  {
    id: "intake",
    title: "Documents in, structured data out",
    body: "Agents that watch drop folders and inboxes, read placement files, drawings and forms, map them onto your schema, and hand a clean file to the system that already runs the process.",
    spotlights: ["intake", "drawing-takeoff"],
  },
  {
    id: "reporting",
    title: "Reporting across every system you run",
    body: "Consolidated financials across four ERPs, a quoting control tower over forwarding systems, clinical reports over device data: governed connectors, one lakehouse, questions in plain English.",
    spotlights: ["erp-consolidation", "logistics-tower", "erp-reporting", "clinical-reports"],
  },
  {
    id: "knowledge",
    title: "Knowledge search with walls in it",
    body: "Retrieval scoped by matter, role and account before the model sees a document. A lawyer searches only their matters; a banker's assistant never sees account data it shouldn't.",
    spotlights: ["matter-wall", "core-banking"],
  },
  {
    id: "operations",
    title: "Operations that pause for approval",
    body: "Scheduled work, compliance gates and back-office automation where every consequential action waits for a human, replays with that person's own credentials, and lands in the audit trail.",
    spotlights: ["phi-gate", "hosting-ops", "back-office"],
  },
  {
    id: "revenue",
    title: "Sales, marketing and content",
    body: "CRM-connected agents with per-user credentials, contact data refreshed through a waterfall of sources, franchise coaching over live numbers, and on-brand proposals from a shared skill.",
    spotlights: ["sales-ops", "contact-refresh", "franchise-coach", "content-coworker"],
  },
];
