// Use case spotlights — workflows FlatClaw runs inside a customer's own
// tenancy. Deliberately anonymized: the pattern is the point, not the logo.
// Filters mirror the selector on /use-cases; every spotlight carries at least
// one use-case tag and one industry tag.

export const USE_CASE_FILTERS = [
  "Customer Engagement",
  "Voice Agents",
  "Data Consolidation",
  "Intake Automation",
  "Compliance & Approvals",
  "Analytics & Reporting",
  "Knowledge Search",
  "Estimating & Quoting",
  "Operations Automation",
  "Data Quality",
  "Sales & Marketing",
] as const;

export const INDUSTRY_FILTERS = [
  "Manufacturing",
  "Healthcare",
  "Financial Services",
  "Logistics",
  "Franchise & Retail",
  "Beauty & Wellness",
  "Legal",
  "Collections",
  "Software / Technology",
  "Professional Services",
  "Construction",
  "IT & MSP",
] as const;

export type UseCaseFilter = (typeof USE_CASE_FILTERS)[number];
export type IndustryFilter = (typeof INDUSTRY_FILTERS)[number];

export interface Spotlight {
  id: string;
  /** Anonymized organization, e.g. "Franchise beauty and wellness group". */
  title: string;
  /** The "Use Case:" line. */
  useCase: string;
  /** The "Results:" line. */
  results: string;
  /** Expanded detail shown on demand. */
  detail: string;
  useCases: UseCaseFilter[];
  industries: IndustryFilter[];
  /** Hue for the card ground; stays inside the navy/blue family. */
  hue: number;
  /** Approximate, rounded revenue or system-wide sales, so the organization stays unnamed. */
  revenue?: string;
  /** Scale line: locations, employees, systems. */
  scale?: string;
}

export const SPOTLIGHTS: Spotlight[] = [
  {
    id: "erp-consolidation",
    title: "Multi-brand industrial manufacturer",
    useCase: "Consolidation, forecast and pricing intelligence across four ERPs",
    results:
      "One governed lakehouse behind an AI agent: audit-grade consolidated financials that trace to the source transaction, forecast and pipeline by business unit, large-job margin watch, and plain-English inquiry over all of it, inside the company's own Azure tenant.",
    detail:
      "Five brands, four ERPs and a CRM feed a lakehouse in the customer's tenant, with entity matching across brands and lineage back to every transaction. FlatClaw sits on top through MCP connectors: finance asks why a margin moved and gets a cited answer; sales asks about a strategic account and gets revenue, margin, pipeline and whitespace across every brand, with the CRM written back. Pricing intelligence and aftermarket analytics follow on the same store, and each acquisition onboards as a templated pattern priced in weeks, not a project each time.",
    useCases: ["Data Consolidation", "Analytics & Reporting", "Knowledge Search"],
    industries: ["Manufacturing"],
    hue: 218,
    revenue: "≈ $200M revenue across five brands (approx.)",
    scale: "5 brands · 4 ERPs · 1 CRM",
  },
  {
    id: "intake",
    title: "Healthcare receivables agency",
    useCase: "Placement-file intake automation",
    results:
      "Placement files arriving in any layout are normalized into the agency's existing upload format, with a human approval queue before anything reaches the system of record. A one-and-a-half-person manual job becomes a review step.",
    detail:
      "The agent watches the drop locations, reads each placement file, maps twenty-five to fifty columns onto the house schema, flags anything it is unsure about, and emits exactly the file the legacy collection system already accepts. Nothing about the system of record changes.",
    useCases: ["Intake Automation", "Compliance & Approvals"],
    industries: ["Collections", "Healthcare"],
    hue: 212,
    revenue: "≈ $10M revenue (approx.)",
    scale: "~60 employees · national client base",
  },
  {
    id: "phi-gate",
    title: "Healthcare receivables agency",
    useCase: "Protected-health-information send gate",
    results:
      "Every outbound file that carries protected health information is checked against the placement it belongs to and held for human approval, with an audit trail of who released what, and when.",
    detail:
      "Built on FlatClaw's approval engine: the agent composes the send but never executes it. A compliance reviewer sees the exact file, the match evidence and any anomalies, and approves or denies from the queue. The kind of incident that used to be caught with a highlighter is caught by the system.",
    useCases: ["Compliance & Approvals"],
    industries: ["Collections", "Healthcare"],
    hue: 222,
    revenue: "≈ $10M revenue (approx.)",
    scale: "~60 employees · regulated healthcare receivables",
  },
  {
    id: "voicemail-lane",
    title: "Regulated outbound contact center",
    useCase: "Compliant voicemail lane beside the existing dialer",
    results:
      "A voicemail lane leaves a message specific to each account, in a consented agent voice, at a volume no floor can match, and shares one attempt ledger with the dialer so contact limits stay enforced in one place.",
    detail:
      "Open-weight speech synthesis runs on the organization's own hardware. Messages follow the limited-content format the rules define, every attempt feeds the dialer's daily file, and a return call reaches the team that left the message.",
    useCases: ["Voice Agents", "Operations Automation"],
    industries: ["Financial Services"],
    hue: 230,
    revenue: "≈ $40M revenue (approx.)",
    scale: "~250 agents · three sites",
  },
  {
    id: "contact-refresh",
    title: "Security certification body",
    useCase: "CRM contact database refresh",
    results:
      "Roughly one hundred thousand contacts validated, deduplicated and enriched through a tiered waterfall of trust. Every changed value carries a source and a confidence tier, and a re-run kit stays with the customer.",
    detail:
      "Verification services and licensed data do the finding; the model only adjudicates junk and duplicate records and reads public pages with a citation attached. The output is a CRM-ready update file, a merge file and a report, delivered in three weeks.",
    useCases: ["Data Quality", "Sales & Marketing"],
    industries: ["Software / Technology"],
    hue: 208,
    revenue: "≈ $10–15M revenue (approx.)",
    scale: "~150 employees · ~100,000 CRM contacts",
  },
  {
    id: "logistics-tower",
    title: "European logistics group",
    useCase: "Quote control tower over forwarding systems",
    results:
      "Quotes that track fuel prices, routing and political risk across the group's forwarding systems, assembled by agents over the company's own data lake and handed to the desk with the reasoning attached.",
    detail:
      "FlatClaw consumes the group's data-lake design as a control tower: finance, operations and an innovation team ask the same governed brain different questions, and margin analysis that used to take a week becomes a conversation.",
    useCases: ["Estimating & Quoting", "Analytics & Reporting"],
    industries: ["Logistics"],
    hue: 200,
    revenue: "≈ $2B revenue",
    scale: "6,000+ employees · 50+ countries",
  },
  {
    id: "clinical-reports",
    title: "Sleep-therapy provider",
    useCase: "Natural-language clinical reports",
    results:
      "Clinicians ask for patient cohorts in plain English and a constrained pipeline turns the question into validated filters, never free-form database queries, on a private GPU that costs a fraction of the hosted model it replaced.",
    detail:
      "The parser emits a fixed schema that is checked against an allowlist of fields before anything runs. Deployed inside a single cloud project so inference never leaves the boundary; on the provider's own benchmark questions the open model reproduced the incumbent hosted model's answers nine times out of ten.",
    useCases: ["Analytics & Reporting", "Knowledge Search"],
    industries: ["Healthcare"],
    hue: 196,
    revenue: "≈ $60M revenue (approx.)",
    scale: "40 clinics · one clinical reporting app",
  },
  {
    id: "matter-wall",
    title: "Global law firm",
    useCase: "Walled-matter research assistant",
    results:
      "Document search and drafting inside the firm's own tenancy: every answer cited to its source, every matter isolated by role, and nothing ever sent to a third-party model.",
    detail:
      "Role-based access maps to matter teams, and retrieval is scoped before the model sees a document. The firm keeps the productivity of a frontier agent and the data posture its clients require.",
    useCases: ["Knowledge Search", "Compliance & Approvals"],
    industries: ["Legal", "Professional Services"],
    hue: 226,
    revenue: "≈ $3B+ revenue",
    scale: "Thousands of lawyers · dozens of offices",
  },
  {
    id: "core-banking",
    title: "Community financial institution",
    useCase: "Governed core-banking assistant",
    results:
      "Staff ask questions of the core banking system through governed MCP tools. Anything consequential is composed and paused for a human, so the assistant is useful without being able to act alone.",
    detail:
      "Connectors mirror the real core-system request shapes rather than inventing them. Read paths are open to the roles that need them; write paths require approval in the queue and replay with the approver's own credentials.",
    useCases: ["Knowledge Search", "Compliance & Approvals"],
    industries: ["Financial Services"],
    hue: 214,
    revenue: "≈ $2.4B in assets (approx.)",
    scale: "30 branches · ~400 employees",
  },
  {
    id: "franchise-coach",
    title: "Franchise operations team",
    useCase: "Franchisee business coach",
    results:
      "An agent that knows the operating playbook and every location's numbers, so a small coaching team's best advice reaches every franchisee, with opportunities surfaced instead of requested.",
    detail:
      "Marketing, operations and systems knowledge live in a maintained knowledge graph over the franchisor's data platform. The coach compares each location against the network's first-year and steady-state patterns and drafts the conversation a human coach then has.",
    useCases: ["Analytics & Reporting", "Customer Engagement"],
    industries: ["Franchise & Retail"],
    hue: 210,
    revenue: "≈ $300M+ system-wide sales (salon brand)",
    scale: "700+ studios · a handful of business coaches",
  },
  {
    id: "back-office",
    title: "Corporate back office",
    useCase: "Shared skills and brand assets portal",
    results:
      "Invoice coding, on-brand presentations and monthly reports from one shared portal where the logic and the assets live in one place, instead of in each person's chat window.",
    detail:
      "An administrator publishes the shared skills, the brand kit and the data connections once; every user's agent calls the same tool and gets the same report, and the private inference bill does not grow per seat.",
    useCases: ["Operations Automation"],
    industries: ["Professional Services"],
    hue: 220,
    revenue: "≈ $350M revenue (approx.)",
    scale: "PE-owned · six operating companies · a 12-person corporate team",
  },
  {
    id: "content-coworker",
    title: "Technology consultancy",
    useCase: "Content production agent",
    results:
      "Sales decks, one-pagers and campaign copy from a private agent with the brand system loaded, running on the company's own inference, with skills shared across the team rather than pasted between chats.",
    detail:
      "The house brand skill carries colors, typography, logo files and a PDF renderer; the agent produces proposals and decks that pass review on the first read, on hardware the company controls.",
    useCases: ["Operations Automation", "Sales & Marketing"],
    industries: ["Software / Technology", "Professional Services"],
    hue: 206,
    revenue: "≈ $8M revenue (approx.)",
    scale: "Boutique consultancy · ~25 consultants",
  },
  {
    id: "hosting-ops",
    title: "Managed hosting operator",
    useCase: "Host-panel and DNS operations agent",
    results:
      "Account provisioning, DNS changes and site deployments through approval-gated connector tools, with each user's own panel credentials scoped to that user and every action in the audit log.",
    detail:
      "A first-party MCP connector for the hosting control panel exposes the operations staff actually perform. Destructive or exposing calls pause for a human; routine reads do not. Deploying a static site becomes a sentence.",
    useCases: ["Operations Automation", "Compliance & Approvals"],
    industries: ["IT & MSP"],
    hue: 218,
    revenue: "≈ $15M revenue (approx.)",
    scale: "3,000+ hosted accounts · a 24/7 operations team",
  },
  {
    id: "drawing-takeoff",
    title: "Data-center construction group",
    useCase: "Drawing takeoff and ROM estimating for hyperscale data-center bids",
    results:
      "From four issue-for-construction drawing sets, 190 sheets, agents itemized 1,045 units across 36 equipment families, matched the estimators' own counts on the big-ticket lines (88 chillers, 216 computer-room air handlers, 36 pumps), and surfaced a 161-versus-280 fan-wall-unit spread between drawings and proposal for adjudication. Hours, not the weeks a manual count takes.",
    detail:
      "The drawings' own embedded markup data is read natively rather than guessed at through a vision model, every count cites the sheets it came from, and duplicate sightings across sheets and sets collapse to one physical unit. The rough-order-of-magnitude estimate renders in the team's own schedule-of-pricing format. Estimators steer it in plain language, with guardrails on how far labor and spares can move without a manager, and the final estimate waits for human approval.",
    useCases: ["Estimating & Quoting"],
    industries: ["Construction", "Manufacturing"],
    hue: 202,
    revenue: "Division of a multinational electrical group · parent revenue in the tens of billions",
    scale: "Hundreds of bids a month · a ten-person estimating team",
  },
  {
    id: "estimation-benchmarks",
    title: "Flooring and concrete contractor",
    useCase: "Estimation benchmarks from twelve years of costing sheets",
    results:
      "Twelve years of costing sheets and work orders become a governed knowledge base; every new estimate is benchmarked by technology and size band against what past jobs actually cost, QA'd before approval, and driven from inside the CRM the sales team already lives in.",
    detail:
      "Epoxy, urethane cement, polished concrete and self-leveling systems each get their own benchmarks: price per square foot, labor hours, material, transport, equipment, per diem. A new estimate is calculated on the company's own cost logic, then compared with the closest historical jobs and their estimated-versus-actual outcomes, so a number that is too low, too high or missing a cost line is caught before it goes out. Completed jobs feed the benchmarks back.",
    useCases: ["Estimating & Quoting", "Data Consolidation", "Analytics & Reporting"],
    industries: ["Construction"],
    hue: 208,
    revenue: "≈ $25M revenue (approx.)",
    scale: "12 years of job history · Zoho CRM · Azure tenant",
  },
  {
    id: "erp-reporting",
    title: "Building-products manufacturer",
    useCase: "The report that writes itself, across three ERPs",
    results:
      "Monthly operating reports assembled by agents from three ERPs that never agreed with each other, with every figure traceable to its source system, so leadership reads one report instead of reconciling three.",
    detail:
      "Each plant runs its own ERP and the corporate month-end was a manual merge. The agent pulls the same figures from each system through governed connectors, normalizes units and entities, flags the mismatches instead of hiding them, and drafts the narrative around the numbers for a human to edit.",
    useCases: ["Analytics & Reporting", "Data Consolidation"],
    industries: ["Manufacturing"],
    hue: 224,
    revenue: "≈ $400M revenue (approx.)",
    scale: "A dozen brands · plants in three countries",
  },
  {
    id: "sales-ops",
    title: "Sales team",
    useCase: "CRM-connected agent",
    results:
      "Pipeline questions, follow-up drafts and account summaries with the CRM connected through each user's own OAuth credentials, so nobody's agent can reach a deal its user cannot see.",
    detail:
      "The CRM connector is a first-party MCP service: per-user credentials scoped to tenant, user and service; outbound messages are approval-gated; everything else is a conversation with the data.",
    useCases: ["Sales & Marketing", "Customer Engagement"],
    industries: ["Software / Technology", "Professional Services"],
    hue: 216,
    revenue: "≈ $120M revenue (approx.)",
    scale: "35-person sales team · one CRM",
  },
  {
    id: "voice-booking",
    title: "Franchise beauty and wellness group",
    useCase: "Inbound booking voice agent",
    results:
      "A private two-way voice agent answers the booking line, matches each caller to one to three professionals and texts them booking links. Text and web chat reuse the same matching service. The day-one tenancy handles twenty-plus simultaneous calls.",
    detail:
      "The phone platform streams each call into a FlatClaw voice service running open speech and language models on two GPUs in the customer's cloud. A structured conversation graph keeps the agent on script; every call lands as a transcript, a reasoning trace and a lead record with attribution, so the franchisor can prove which leads became bookings.",
    useCases: ["Voice Agents", "Customer Engagement"],
    industries: ["Beauty & Wellness", "Franchise & Retail"],
    hue: 204,
    revenue: "≈ $300M+ system-wide sales (salon brand)",
    scale: "700+ locations · two franchise brands",
  },
];

/** Spotlights featured on the home page, in order. */
export const FEATURED_SPOTLIGHT_IDS = ["drawing-takeoff", "erp-consolidation", "intake"];
