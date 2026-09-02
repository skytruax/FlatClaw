// Long-form detail for each use case spotlight (the /use-cases/<slug>/ pages).
// Anonymized organizations described concretely: size, systems, constraint,
// what was built, what changed. No customer names, no invented metrics.

export interface SpotlightDetail {
  /** Short facts strip: [label, value] pairs. */
  facts: [string, string][];
  /** The situation before FlatClaw, in prose. */
  situation: string;
  /** What FlatClaw does for them, as bullets. */
  solution: string[];
  /** What changed, as bullets. Honest, qualitative where numbers are not ours to claim. */
  outcomes: string[];
  /** Components and connectors involved. */
  stack: string[];
  /** Where the tenancy runs. */
  runsOn: string;
  /** Why the private model mattered for this one. */
  whyPrivate: string;
}

export const SPOTLIGHT_DETAILS: Record<string, SpotlightDetail> = {
  "erp-consolidation": {
    facts: [
      ["Organization", "Multi-brand industrial manufacturer, several acquired business units"],
      ["Systems", "Four ERPs, one CRM, spreadsheet-driven consolidation"],
      ["Runs on", "Microsoft Azure, in the customer's own tenant"],
      ["Scope", "Governed lakehouse plus an AI coworker over it"],
    ],
    situation:
      "Each acquired brand kept its own ERP, and the group's consolidated view lived in spreadsheets stitched together every month by hand. Leadership could not ask a simple question across brands, could not trust a number without knowing which spreadsheet it came from, and every new acquisition restarted the whole exercise. The group runs on Microsoft, so a second data cloud was never on the table.",
    solution: [
      "A governed lakehouse in the customer's Azure tenant, fed from all four ERPs and the CRM on a schedule, with entity mapping and consolidation logic that keeps an audit trail back to the source transaction.",
      "FlatClaw on top, connected through MCP tools: finance asks why a margin moved and gets a cited answer; sales gets a 360-degree view of a strategic account across every brand it touches, with updates written back to the CRM.",
      "Board-grade consolidated financials and business-unit scorecards produced from the same governed data the coworker answers from, so the report and the conversation never disagree.",
      "An onboarding pattern for the next acquisition: map the new ERP once, and the coworker, the scorecards and the consolidation inherit it.",
    ],
    outcomes: [
      "One set of numbers, traceable to source, instead of a monthly reconciliation exercise.",
      "Plain-English inquiry across brands for people who never opened an ERP.",
      "Acquisitions land as a repeatable integration instead of a project each time.",
      "Nothing about the data or the model leaves the company's Azure tenant.",
    ],
    stack: ["FlatClaw Portal", "Agent harness (Pi core)", "ERP and CRM MCP connectors", "Lakehouse on Microsoft Fabric", "Private inference on a dedicated GPU", "Entra ID sign-in"],
    runsOn: "Microsoft Azure",
    whyPrivate:
      "Consolidated financials for a private group are exactly the data that cannot be sent to a third-party model on every question. The coworker answers from the lakehouse inside the tenant, and the audit trail makes every answer defensible.",
  },
  "voice-booking": {
    facts: [
      ["Organization", "Franchise beauty and wellness group, hundreds of locations"],
      ["Channel", "Inbound booking calls on each location's existing number"],
      ["Runs on", "The customer's cloud tenancy, two GPUs"],
      ["Scope", "Voice agent first; text and web chat on the same brain"],
    ],
    situation:
      "Consumers call a location to book, and the booking branch of the phone tree mostly ends in voicemail: locations are run by independent professionals, not a front desk. The group wanted every caller matched to the right professional and handed a way to book, without touching the leasing side of the same phone number and without owning anyone's calendar.",
    solution: [
      "A private two-way voice agent attached to the booking branch of the existing phone platform, location by location; leasing, inboxes and voicemail behave exactly as before, and voicemail remains the fallback.",
      "A real conversation: streaming speech recognition, an open-weight language model and natural speech synthesis running on two GPUs in the customer's cloud, with interruptions handled the way a person would.",
      "A matching and routing service built as its own API: it holds each location's professional directory and services, recommends one to three professionals with reasons, and texts the caller booking links; text and web chat become new front doors onto the same service.",
      "Every call lands as a transcript, a reasoning trace and a lead record with attribution, so the group can prove which leads became bookings.",
    ],
    outcomes: [
      "The booking line is answered every time, at every hour, instead of landing in voicemail.",
      "Callers leave with a text naming the right professionals and a link to book.",
      "The day-one tenancy handles twenty-plus simultaneous calls; capacity grows by adding voice workers.",
      "Lead attribution good enough to build a per-lead business model on.",
    ],
    stack: ["FlatClaw voice service", "Structured conversation graph", "Matching and routing service", "Phone platform media streams", "Open speech and language models on dedicated GPUs", "Review console"],
    runsOn: "The customer's cloud tenancy",
    whyPrivate:
      "Caller audio, phone numbers and conversation history are consumer data. They never leave the group's own cloud account, and the branded voice is an asset the group owns rather than rents by the minute.",
  },
  intake: {
    facts: [
      ["Organization", "Healthcare receivables agency, on-premise, regulated"],
      ["Volume", "Placement files in twenty-five to fifty column layouts, from many clients"],
      ["Runs on", "The agency's own hardware"],
      ["Scope", "Intake normalization with a human approval queue"],
    ],
    situation:
      "Every client sends placement files in its own layout. A person and a half spent their days turning those files into the one upload format the thirty-year-old collection system accepts. A failed system conversion the year before had made the agency rightly cautious: whatever came next could not touch the system of record.",
    solution: [
      "The coworker watches the drop locations, reads each incoming placement file, and maps its columns onto the house schema using rules the intake team helped write.",
      "Anything it is unsure about is flagged, not guessed; the whole batch waits in an approval queue where a reviewer sees the mapping and the exceptions before release.",
      "Output is exactly the upload file the collection system already accepts, so nothing about the system of record changes.",
      "Runs entirely on hardware inside the agency's building.",
    ],
    outcomes: [
      "Intake becomes a review step instead of a data-entry job.",
      "New client layouts are handled by adding a mapping, not by retraining a person.",
      "Zero changes to the legacy system that the business depends on.",
      "Every release is auditable: who approved which batch, and what was flagged.",
    ],
    stack: ["FlatClaw Portal", "Agent harness (Pi core)", "Approval engine", "File-watch and normalization skills", "Private inference on an on-prem GPU"],
    runsOn: "On-premise hardware",
    whyPrivate:
      "Placement files carry protected health information. The agency's compliance posture depends on that data never leaving the building, so the coworker runs where the data already lives.",
  },
  "phi-gate": {
    facts: [
      ["Organization", "Healthcare receivables agency, on-premise, regulated"],
      ["Risk", "Outbound files carrying protected health information"],
      ["Runs on", "The agency's own hardware"],
      ["Scope", "Send verification with human approval and audit"],
    ],
    situation:
      "A file sent to the wrong recipient with protected health information inside is the agency's worst day. The manual control was attention: a person checking a highlighted list before hitting send. It worked until the day it did not, and the compliance team that followed needed a control that could not be skipped.",
    solution: [
      "Built on FlatClaw's approval engine: the agent composes every outbound send that carries protected information, but never executes it.",
      "Before the file reaches the queue, the coworker checks it against the placement it belongs to, the recipient, and the expected shape of the data, and attaches the evidence and any anomalies.",
      "A compliance reviewer approves or denies from the queue; on approve, the send replays with the reviewer's own credentials; on deny, nothing happens.",
      "Both outcomes, with the approver's identity, land in the audit log.",
    ],
    outcomes: [
      "The control is structural: a send cannot happen without a recorded human decision.",
      "Reviewers see evidence, not a highlighted spreadsheet.",
      "Audit questions are answered from the log, not from memory.",
      "The same engine gates every other consequential action the coworker can take.",
    ],
    stack: ["Approval engine", "FlatClaw Portal approvals queue", "Agent harness (Pi core)", "Audit log", "Private inference on an on-prem GPU"],
    runsOn: "On-premise hardware",
    whyPrivate:
      "The files being checked are the sensitive data itself. Checking them with a hosted model would create the very exposure the control exists to prevent.",
  },
  "voicemail-lane": {
    facts: [
      ["Organization", "Collections floor inside a receivables agency"],
      ["Reality", "Most of a collector's day is answering machines"],
      ["Runs on", "Two GPUs in the agency's building"],
      ["Scope", "A compliant voicemail lane beside the existing dialer"],
    ],
    situation:
      "Collectors spend the majority of their day leaving voicemails. A human leaves a hundred rushed, identical messages; a robocall leaves a voice nobody returns. The dialer vendor's virtual agent was quoted at six figures and would not share the agency's own attempt limits.",
    solution: [
      "Each collector's voice is cloned from a thirty-second sample, with written consent, using an open-weight voice model on the agency's own GPU.",
      "Every message is personal to the account and spoken in the assigned collector's voice, with that collector's callback line, and every message follows the limited-content format the regulation defines.",
      "Attempts feed the dialer's daily file, so contact caps are enforced in one place, and the debtor who calls back reaches the voice they heard.",
      "The lane runs beside the existing dialer through its supported file and transfer surfaces; collectors keep their tools.",
    ],
    outcomes: [
      "Personal outreach at machine scale, in the voice the account already knows.",
      "One attempt ledger shared with the dialer instead of a second system to reconcile.",
      "No per-minute vendor bill, and the voices are the agency's own assets.",
      "The same voice stack carries the agency's other phone workflows.",
    ],
    stack: ["Open-weight voice cloning and synthesis", "Streaming speech recognition", "Dialer file and transfer integration", "Attempt ledger", "Private inference on on-prem GPUs"],
    runsOn: "On-premise hardware",
    whyPrivate:
      "Debtor conversations are regulated and sensitive. Keeping the voice loop and the transcripts inside the building keeps the agency's certifications intact.",
  },
  "contact-refresh": {
    facts: [
      ["Organization", "Security certification body with a seventeen-year-old CRM"],
      ["Data", "Roughly one hundred thousand contacts, enriched once and never again"],
      ["Runs on", "Kirk-operated infrastructure, then handed back"],
      ["Scope", "Validate, deduplicate, enrich, enhance; three weeks"],
    ],
    situation:
      "An event list pulled for one city came back mostly wrong: people who had moved, titles from years ago, work addresses for people who now work from home. The database had been enriched once by two successive vendors and then left alone. The alternative under consideration was months of manual lookups offshore.",
    solution: [
      "A defined waterfall of trust: cheap, authoritative verification of every email and phone first; deduplication with exact and fuzzy matching; enrichment only where records fail or matter, starting with the subscription the customer already paid for.",
      "The model plays a small, bounded part: adjudicating junk and duplicate records, reading public web pages with the URL attached as evidence, and normalizing free-text titles.",
      "A residence-metro inference held in its own field, so event outreach can target where people live without overwriting the company address.",
      "Every changed value carries a source and a confidence tier; the pipeline is delivered as a re-run kit the customer keeps.",
    ],
    outcomes: [
      "An import-ready update file with a trust tier on every value, in three weeks.",
      "Duplicates and junk identified with a merge file rather than merged blindly.",
      "Third-party costs shown line by line, so the margin is visible.",
      "Repeatable next quarter by pressing a button.",
    ],
    stack: ["Verification services", "Licensed enrichment data", "Search and page reading with citations", "Claude on the Anthropic API for adjudication", "Re-run kit"],
    runsOn: "Kirk infrastructure, delivered back to the customer",
    whyPrivate:
      "Contact data is personal data. Each service sees only the field it needs, every external call is logged per record, and all copies are deleted after acceptance.",
  },
  "logistics-tower": {
    facts: [
      ["Organization", "European freight forwarding and logistics group"],
      ["Inputs", "Fuel prices, routing, political risk, forwarding systems"],
      ["Runs on", "The group's cloud tenancy over its data lake"],
      ["Scope", "A quote control tower for three internal consumers"],
    ],
    situation:
      "Quotes depend on inputs that change daily, fuel above all, and on data scattered across forwarding systems and a partner's API. Finance, operations and an innovation team each wanted a different view of the same facts, and a data-lake program was already underway that the coworker could sit on top of rather than replace.",
    solution: [
      "FlatClaw as a consumer of the group's data lake: a control tower that reads the forwarding systems and the partner API through governed connectors.",
      "Agents assemble quotes that track fuel, routing and risk, and hand them to the desk with the reasoning attached rather than a number alone.",
      "Three front doors onto one brain: finance asks about margin, operations about exceptions, the innovation team about what to build next.",
      "Cited answers grounded in the lake, so a quote can be defended a month later.",
    ],
    outcomes: [
      "Margin analysis that took a week becomes a conversation.",
      "Quotes carry their assumptions, so they can be challenged and corrected.",
      "The data-lake investment gains an interface people actually use.",
      "One governed system instead of three departmental tools.",
    ],
    stack: ["FlatClaw Portal", "Agent harness (Pi core)", "Forwarding-system and partner-API connectors", "Data-lake retrieval", "Private inference on a dedicated GPU"],
    runsOn: "The group's cloud tenancy",
    whyPrivate:
      "Pricing logic and customer contracts are the business. They stay in the group's own tenancy, and the model never sees them from outside it.",
  },
  "clinical-reports": {
    facts: [
      ["Organization", "Sleep-therapy provider with a clinical reporting application"],
      ["Question", "Could a small open model replace the hosted model in a constrained parser?"],
      ["Runs on", "A single cloud project with an inexpensive GPU"],
      ["Scope", "Natural-language report queries, validated before execution"],
    ],
    situation:
      "Clinicians wanted to ask for cohorts in plain English: patients within a range of adherence, a number of days, a device condition. The existing parser used a hosted frontier model, which meant every question left the provider's environment and cost money per call. The team needed to know whether a private model could match it before committing.",
    solution: [
      "A constrained-intent pipeline: the model emits a fixed schema that is checked against an allowlist of fields before anything runs; never free-form database queries.",
      "A small open-weight model served on an inexpensive GPU inside the same cloud project as the application, so inference never crosses the boundary.",
      "A provider seam that lets the application switch between the hosted model and the private one with an environment variable.",
      "The provider's own benchmark questions replayed against both to settle the question with evidence.",
    ],
    outcomes: [
      "The open model reproduced the hosted model's answers on nine of ten benchmark questions; the tenth was unverifiable in the original logs.",
      "Every query valid against the schema; no invented fields.",
      "Inference at a fraction of the hosted model's cost, and the GPU can be paused when idle.",
      "A dress rehearsal for larger private deployments on the same pattern.",
    ],
    stack: ["Constrained-intent parser", "Open-weight model on a small GPU", "Schema and field allowlist", "Django application in the same project", "Private inference endpoint"],
    runsOn: "A single cloud project, private inference endpoint",
    whyPrivate:
      "Clinical data belongs inside the provider's boundary. Keeping the parser's model in the same project made the privacy claim mechanical rather than contractual.",
  },
  "matter-wall": {
    facts: [
      ["Organization", "Global law firm"],
      ["Constraint", "Client matters must be walled from each other and from outside models"],
      ["Runs on", "The firm's own cloud tenancy"],
      ["Scope", "Research and drafting inside the wall"],
    ],
    situation:
      "The firm benchmarks every AI tool on the market and has the productivity numbers to prove the category works. What it cannot do is send client documents to a vendor's model, or let a lawyer on one matter retrieve documents from another. The frontier coworkers are built on both.",
    solution: [
      "FlatClaw deployed inside the firm's tenancy with role-based access mapped to matter teams.",
      "Retrieval scoped before the model sees a document: a lawyer's coworker can only search the matters that lawyer is on.",
      "Every answer cited to its source document, so a draft can be checked rather than trusted.",
      "The same governed coworker for research, drafting and summarization, with the firm's own style and precedents in its knowledge base.",
    ],
    outcomes: [
      "The productivity of a frontier coworker with the data posture the firm's clients require.",
      "Matter isolation enforced by the system, not by policy reminders.",
      "Answers that carry their citations into the work product.",
      "A platform the firm owns and can extend for practice groups.",
    ],
    stack: ["FlatClaw Portal", "Agent harness (Pi core) with per-user tool policy", "Cited document retrieval", "Matter-scoped knowledge bases", "Private inference on dedicated GPUs"],
    runsOn: "The firm's own cloud tenancy",
    whyPrivate:
      "Privilege and confidentiality are not features a vendor can promise on a firm's behalf. Running the model inside the tenancy keeps the obligation where it belongs.",
  },
  "core-banking": {
    facts: [
      ["Organization", "Community financial institution"],
      ["System", "Core banking platform with a well-defined request surface"],
      ["Runs on", "The institution's own cloud tenancy"],
      ["Scope", "Governed assistant with approval-gated actions"],
    ],
    situation:
      "Staff wanted to ask the core system questions in plain language: account status, transaction history, exception queues. The institution's IT security team, reasonably, would not allow an assistant that could act on the core system on its own, and would not allow the core's data to leave the tenancy.",
    solution: [
      "MCP connectors that mirror the core platform's real request shapes rather than inventing an abstraction over them.",
      "Read paths open to the roles that need them, with per-user credentials so an answer never exceeds what that person could see themselves.",
      "Write paths composed by the agent and paused in the approval queue; on approve, the request replays with the approver's own credentials.",
      "Every decision and every replayed request recorded in the audit log.",
    ],
    outcomes: [
      "A useful assistant that cannot act alone.",
      "Security review passed on the strength of the approval engine and the audit trail.",
      "Consistent answers for staff who previously escalated to a specialist.",
      "A pattern the institution can extend to other systems.",
    ],
    stack: ["Core-banking MCP connectors", "Approval engine", "Per-user credential vault", "FlatClaw Portal", "Private inference on a dedicated GPU"],
    runsOn: "The institution's own cloud tenancy",
    whyPrivate:
      "Account data does not leave a bank's boundary, full stop. The coworker's usefulness had to be earned without any of that data reaching a third party.",
  },
  "franchise-coach": {
    facts: [
      ["Organization", "Franchise operations team supporting hundreds of owners"],
      ["Reality", "A handful of business coaches for the whole network"],
      ["Runs on", "The franchisor's cloud tenancy over its data platform"],
      ["Scope", "A coaching agent over the playbook and the numbers"],
    ],
    situation:
      "A small team of business coaches is responsible for helping every franchisee maximize an investment. The coaches carry the playbook, the marketing tactics, the systems knowledge and the numbers in their heads, and there are not enough of them to reach every location as often as the network needs.",
    solution: [
      "The operating playbook, marketing and systems knowledge in a maintained knowledge base, refreshed as the underlying sources change.",
      "The coworker connected to the franchisor's data platform, so it knows every location's numbers and the network's patterns: what a healthy first year looks like, where cash problems tend to appear.",
      "For each location, the agent surfaces the opportunities and drafts the conversation; a human coach has it.",
      "Franchisees ask their own questions of the same governed knowledge, within what they are allowed to see.",
    ],
    outcomes: [
      "A coach's best advice reaches every franchisee instead of the ones on this month's calendar.",
      "Opportunities surfaced from the data rather than requested.",
      "Coaching time spent on conversations, not on assembling the numbers first.",
      "One knowledge base that improves every time a coach corrects it.",
    ],
    stack: ["FlatClaw Portal", "Knowledge base with continuous refresh", "Data-platform connectors", "Role-based access for coaches and owners", "Private inference on a dedicated GPU"],
    runsOn: "The franchisor's cloud tenancy",
    whyPrivate:
      "Every location's financial performance is confidential to the franchisor and the owner. A private coworker can reason over all of it; a hosted one could not be given it.",
  },
  "back-office": {
    facts: [
      ["Organization", "Corporate back office of a private-equity-owned group"],
      ["Reality", "Small team, many recurring tasks, everyone using a different chat tool"],
      ["Runs on", "The group's cloud tenancy"],
      ["Scope", "Shared skills and brand assets in one portal"],
    ],
    situation:
      "People were already using chat assistants for invoice coding, presentations and reports, and getting different answers, in different formats, from the same prompt. Skills could not be shared between individual accounts, brand guidelines were reapplied by hand every time, and the private inference bill would have grown with every seat.",
    solution: [
      "An administrator publishes shared skills once: invoice coding rules, the monthly report, the presentation template.",
      "The brand kit and data connections live in one place and every user's coworker calls the same tools, so the output is the same for everyone.",
      "Role-based access keeps finance tools with finance and marketing assets with marketing.",
      "Flat-rate private inference: adding a user adds no per-seat model cost.",
    ],
    outcomes: [
      "One report, one format, produced the same way by everyone.",
      "Invoice coding that follows the rules every month instead of most months.",
      "Presentations that come out on brand without a second pass.",
      "The 'everyone has their own assistant' bill replaced by one tenancy.",
    ],
    stack: ["FlatClaw Portal with shared skills", "Brand asset library", "Finance and document connectors", "Role-based access", "Private inference on a dedicated GPU"],
    runsOn: "The group's cloud tenancy",
    whyPrivate:
      "Invoices, board materials and internal reports are exactly the documents a company does not want in a vendor's training set. Shared skills only work well when everyone can use them on the real data.",
  },
  "content-coworker": {
    facts: [
      ["Organization", "Technology consultancy"],
      ["Reality", "Proposals, decks and campaign copy produced daily, to a brand standard"],
      ["Runs on", "The consultancy's own inference"],
      ["Scope", "A content coworker with the brand system as a skill"],
    ],
    situation:
      "A consulting team produces proposals, one-pagers and decks constantly, and every one has to pass review on brand and on substance. Prompts and brand rules lived in individual chat histories and were pasted between people, and the results varied with whoever wrote the prompt.",
    solution: [
      "The house brand system packaged as a skill: colors, typography, logo files and a renderer that turns HTML into branded documents.",
      "Shared across the team through the same portal, so a proposal built by anyone comes out in the house style.",
      "Research, drafting and rendering as one workflow, on the company's own inference, with client material never leaving it.",
      "Skills versioned in a repository so improvements reach everyone at once.",
    ],
    outcomes: [
      "Proposals and decks that pass first review far more often.",
      "New team members productive on the brand in their first week.",
      "Client material handled inside the company's own systems.",
      "A skills library that compounds instead of a prompt folder that rots.",
    ],
    stack: ["FlatClaw Portal", "Brand system skill and renderer", "Document and research skills", "Skills repository", "Private inference"],
    runsOn: "The consultancy's own inference",
    whyPrivate:
      "Proposals contain client pricing and strategy. Producing them on private inference keeps every draft inside the firm.",
  },
  "hosting-ops": {
    facts: [
      ["Organization", "Managed hosting operator"],
      ["System", "A commercial hosting control panel with a broad API"],
      ["Runs on", "The operator's own tenancy"],
      ["Scope", "Operations agent with approval-gated actions"],
    ],
    situation:
      "Routine hosting operations, account provisioning, DNS changes and deployments, were done by hand through the control panel, one screen at a time. The operator wanted the speed of an agent without the risk of an agent deleting a zone or an account on its own.",
    solution: [
      "A first-party MCP connector for the control panel exposing the operations staff actually perform, with each user's own panel credentials scoped to that user.",
      "Reads and routine changes run directly; destructive or exposing calls pause in the approval queue for a human.",
      "Deploying a static site becomes a sentence: build, upload, extract, verify, with the agent reporting what it did.",
      "Every action, approved or denied, recorded in the audit log.",
    ],
    outcomes: [
      "Operations that took a sequence of screens take one request.",
      "No unattended destructive action is possible by construction.",
      "Credentials never shared between users or stored in a prompt.",
      "The connector pattern reused for the operator's other systems.",
    ],
    stack: ["Hosting control-panel MCP connector", "Approval engine", "Per-user credential vault", "FlatClaw Portal", "Private inference"],
    runsOn: "The operator's own tenancy",
    whyPrivate:
      "Panel credentials and customer account data cannot pass through a third-party model. The connector holds them in a vault and the model only ever sees the request it composed.",
  },
  "drawing-takeoff": {
    facts: [
      ["Organization", "Data-center construction group"],
      ["Inputs", "Hundreds of pages of electrical drawings per bid"],
      ["Runs on", "Private inference in the estimating team's environment"],
      ["Scope", "Quantity takeoff and a rough-order-of-magnitude estimate"],
    ],
    situation:
      "Quoting a data center means counting every panel, feeder and device across hundreds of drawing pages, and it takes an estimating team weeks. The drawings carry the estimator's own markups, and the count has to reconcile with those markups or nobody trusts it.",
    solution: [
      "Agents read the drawing markups natively, rather than through a vision model guessing at pictures, and build a quantity census page by page.",
      "Cross-checks between pages catch the double counts and the misses before a human sees them.",
      "The census is delivered in the estimating team's own format, with page references, as a rough-order-of-magnitude estimate.",
      "The estimator reviews and corrects; the corrections improve the next run.",
    ],
    outcomes: [
      "A weeks-long counting cycle becomes a day of review.",
      "A census that reconciles with the team's own count, with page references to check.",
      "Estimators spend their time on judgment rather than tallying.",
      "The same pipeline applies to the next bid without re-engineering.",
    ],
    stack: ["Drawing-native markup readers", "Census and cross-check agents", "Estimate renderer in the team's format", "FlatClaw Portal", "Private inference on dedicated GPUs"],
    runsOn: "Private inference in the customer's environment",
    whyPrivate:
      "Bid drawings and pricing are competitively sensitive. Processing them on private inference keeps a bid inside the team that owns it.",
  },
  "erp-reporting": {
    facts: [
      ["Organization", "Building-products manufacturer, private-equity owned, several plants"],
      ["Systems", "Three ERPs from three eras, one corporate spreadsheet"],
      ["Runs on", "The manufacturer's cloud tenancy"],
      ["Scope", "Monthly operating reports assembled and narrated by agents"],
    ],
    situation:
      "Three plants, three ERPs, and a month-end that was a person copying numbers into a corporate workbook and explaining the differences by email. Every figure had a story, and the story lived with whoever assembled it. New ownership wanted a report it could trust without a call to ask what the numbers meant.",
    solution: [
      "Governed connectors into each ERP, read-only, with the mapping between plants' units, cost centers and product families held in one maintained model.",
      "Agents assemble the operating report on a schedule: pull, normalize, reconcile, and flag mismatches between systems rather than quietly picking one.",
      "A drafted narrative around the numbers, in the company's own format, for the controller to edit rather than write.",
      "Every figure carries a reference back to the source transaction set, so a question about a number is a click, not a call.",
    ],
    outcomes: [
      "One monthly report instead of three reconciled by hand.",
      "Mismatches between systems surface as findings rather than getting averaged away.",
      "The controller edits a draft instead of building a workbook.",
      "A foundation for consolidating the ERPs later, without waiting for that project to read the numbers now.",
    ],
    stack: ["ERP MCP connectors", "Scheduled tasks", "Reconciliation and narrative skills", "FlatClaw Portal", "Private inference on a dedicated GPU"],
    runsOn: "The manufacturer's cloud tenancy",
    whyPrivate:
      "Plant-level margins and pricing are the company's most sensitive numbers. Assembling them on private inference keeps the report inside the company that owns it.",
  },
  "sales-ops": {
    facts: [
      ["Organization", "Sales team on a CRM"],
      ["Reality", "Deal data visible to some, not to all"],
      ["Runs on", "The company's cloud tenancy"],
      ["Scope", "A CRM-connected coworker with per-user credentials"],
    ],
    situation:
      "Sales wanted a coworker that could answer pipeline questions, draft follow-ups and summarize accounts. The blocker was access: a shared integration would let anyone's assistant see everyone's deals, and outbound messages sent by an agent without review were a non-starter.",
    solution: [
      "The CRM connected as a first-party MCP service with credentials scoped to tenant, user and service: each person's coworker sees exactly what that person can see.",
      "Outbound messages composed by the agent and approval-gated before they leave.",
      "Pipeline questions, account summaries and follow-up drafts as a conversation with the data.",
      "Scheduled work, like a Monday pipeline brief, run per user with that user's own access.",
    ],
    outcomes: [
      "No one's agent can reach a deal its user cannot.",
      "Follow-ups drafted in minutes and sent only after a human says so.",
      "A pipeline brief that arrives before the meeting instead of during it.",
      "The same connector pattern for the next system sales asks for.",
    ],
    stack: ["CRM MCP connector", "Per-user OAuth credentials", "Approval engine", "Scheduled tasks", "FlatClaw Portal", "Private inference"],
    runsOn: "The company's cloud tenancy",
    whyPrivate:
      "Pipeline data is the company's forecast. Per-user credentials and private inference keep it exactly as visible as it was before the coworker arrived, and no more.",
  },
};
