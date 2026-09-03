# FlatClaw brand

FlatClaw is **the open-source Private AI Platform**, a Kirk Open Source
Community Project from [Kirk Tech Solutions](https://kirktechsolutions.com).
Its brand is a **child of the Kirk brand system**: the same typeface, the same
structural palette, the same document and page architecture. What changes is
the accent. Kirk is orange; FlatClaw is blue. Everything else is inherited so
that a FlatClaw page, a Kirk proposal and a co-branded deck read as one family.

The tokens below are the source of truth for the website (flatclaw.org,
`web/styles/globals.css`), the portal, and any
FlatClaw-branded document. `flatclaw-brand.css` in this folder carries them for
any surface that is not the Next.js site or a Kirk-rendered document; the
`flatclaw-branding` plugin in the kirk-skills marketplace carries the same
system for PDFs.

## Verbal identity

This is the part that changed most in September 2026, and the part a document
gets wrong most easily. The site is the reference; match it.

**The product is "the open-source Private AI Platform".** When "Private AI
Platform" is the product name it is capitalized, every time: in a headline, a
title, a footer, a calendar invite. Generic prose stays lowercase ("private AI
infrastructure", "a private deployment"). The subline in the logo,
PRIVATE AI PLATFORM, is the same phrase set in caps.

**FlatClaw is a platform, not a coworker.** "AI coworker" was retired on
September 2, 2026 at Steve's request. Do not describe FlatClaw as a coworker,
an assistant, a bot, or a component. Things that run *on* the platform are
**agents**: voice agents, intake agents, CRM-connected agents. The one
surviving "coworker" is inside the Kirk press-release URL, which cannot change.

**Canonical lines.** Use these verbatim where a strapline, title or one-line
description is needed, rather than inventing a new one:

| Where | Line |
|---|---|
| Page title, browser tab | FlatClaw — the open-source Private AI Platform |
| Strapline, cover tagline | The open-source Private AI Platform. |
| One-line description (share cards, invites) | The Private AI Platform you own. The capabilities of the frontier-lab products, none of the data egress. Apache 2.0. |
| Hero headline | The open-source Private AI Platform. |
| The argument | A platform you deploy, not a service you rent. |
| Share image headline | The AI platform you own, on infrastructure you control |
| Provenance line | A Kirk Open Source Community Project |
| Demo invite | Demo of FlatClaw — the open-source Private AI Platform, delivered by Kirk Tech Solutions. |
| Closing call | Pull it. Audit it. Run it. |

**How the argument runs.** The frontier labs showed what AI can do inside an
organization; credit them by name as "the capabilities of Claude Cowork,
Gemini Enterprise Agent and GPT-6 + Atlas", never as "the same product shape".
They deliver it as a service, on their servers, with the data sent over on
every request. FlatClaw is the whole platform deployed into a tenancy the
customer owns: inference on their own GPU, agents, voice, retrieval,
connectors, approvals, scheduling and memory, role-based access at every tool
call, an audit trail under all of it. Build every use case on one foundation
instead of buying a vendor per problem. Open source, Apache 2.0, every line
theirs to read. Data locality is "mechanically verifiable, not marketed": the
tcpdump test, zero bytes of vendor egress.

**Where it runs.** Always the same list, in this order: **Azure, AWS, Google
Cloud, Northflank, or your own hardware.** Never lead with a single cloud. The
stat block is 1× H100-class GPU per tenant, Apache 2.0, 0 bytes vendor egress;
the cost line is about $2,000 a month per tenant, every use case, one flat
rate.

**The seven families of work.** When describing what the platform runs, use
these, in this order. Estimating leads.

1. Estimating and quoting from drawings, specs and history
2. Voice agents on your own lines
3. Documents in, structured data out
4. Reporting across every system you run
5. Knowledge search with walls in it
6. Operations that pause for approval
7. Sales, marketing and content

**Proof, anonymized.** Customers are never named in FlatClaw material; the
spotlights on the site describe the organization ("a global law firm", "a
salon and spa franchisor") and carry a rounded revenue and scale line from
public sources so nothing is a searchable fingerprint. Each family is "backed
by a real engagement: a deployment, a demo or a signed proposal, anonymized".
Do not claim a family is "running for a customer today" unless it is. The
estimating numbers are real and may be quoted: 190 drawing sheets read on one
bid, 1,045 units across 36 equipment families, chiller and CRAH counts
matching the estimators, the 161-versus-280 spread surfaced for adjudication.

**Words to avoid.** "Coworker", "pilot" (say "starting surface" or "launch
locations"), "compliance play", "vendor lock-in" as a feature, and any
customer name.

## Relationship to Kirk

| | Kirk Tech Solutions | FlatClaw |
|---|---|---|
| Typeface | Inter | Inter (inherited) |
| Code | System monospace | JetBrains Mono on web and portal (inherited stack in print) |
| Dark ground | Navy `#22314A` | Navy `#22314A` (inherited) |
| Headings | Deep `#27436C` | Deep `#27436C` (inherited) |
| Body | Navy `#22314A` · Slate `#415A80` | Same (inherited) |
| Accent | Orange `#FA6900` | **Signal blue `#0099FF`** |
| Deep accent | — | **Dark blue `#006BB2`** (hover, eyebrows on light) |
| Small color on navy | Sky `#51C5FF` | Sky `#51C5FF` (inherited) |
| Logo | KIRK wordmark, orange notch | FlatClaw claw + wordmark, with or without the PRIVATE AI PLATFORM subline |
| Co-branding | — | Kirk \| FlatClaw lockup; Kirk logo + divider + tagline wordmark on the web footer |

Kirk orange never appears on a FlatClaw surface except inside the Kirk logo
within the lockup or the footer block. FlatClaw blue never appears on a Kirk
surface.

## Color

| Token | Hex | HSL (web tokens) | Role |
|---|---|---|---|
| Navy | `#22314A` | `218 37% 21%` | Dark grounds: header, hero, footer, dark sections, the featured tile; body text on light |
| Deep | `#27436C` | `215 47% 29%` | Major headings, table header fill |
| Slate | `#415A80` | `216 33% 38%` | Subheadings, secondary text |
| Slate light | `#556D91` | `216 26% 45%` | Eyebrow / section-label text |
| Mute | `#7F91A8` | `214 19% 58%` | Captions, metadata, footer text |
| Ink | `#18191F` | `231 13% 11%` | Near-black panels and cards inset on light pages |
| Off-black | — | `218 37% 12%` | Selection text on the web |
| **Blue** | **`#0099FF`** | `204 100% 50%` | **Primary accent:** CTAs, headline highlights, rules, list markers, focus rings, eyebrows and stat values on navy |
| **Dark blue** | **`#006BB2`** | `204 100% 35%` | Hover states, links and eyebrows on light backgrounds, button fill where white text needs more contrast |
| Sky | `#51C5FF` | `202 100% 66%` | Small colored text on the navy ground in print (kickers, labels): AA contrast where blue is not |
| Wash | `#F4F4F4` | `0 0% 96%` | Callout and zebra-row fill in print |
| Line | `#D8DEE7` | `216 24% 87%` | Hairline rules, card borders |
| Paper | `#FFFFFF` | `0 0% 100%` | Page, card surface |

Light grounds on the web are a cool off-white ramp rather than pure white:
page `210 25% 98%`, soft section `210 28% 96%`, secondary `210 22% 95%`,
tertiary (card rings, dividers) `214 22% 88%`, surface (cards) white. Blue
tints for emphasis are the accent at 8 to 12 percent opacity with a ring at
35 to 50 percent.

**Contrast rules.** White on `#0099FF` measures about 3:1: acceptable for bold
button labels and display sizes, not for body copy. Use `#006BB2` behind white
body-size text (5.2:1), and Sky `#51C5FF` for anything small and colored on
navy in print (6.7:1). On the web, small uppercase eyebrows on navy are set in
`#0099FF` at 600 weight and 10.5px, which the site accepts for labels only;
never for running text.

## Type

Inter, every medium. Weights 400 / 600 / 700 / 800. Display sizes take
`letter-spacing: -0.02em`; running text stays at natural tracking. Fallback
chain: Inter → system sans (`-apple-system`, Segoe UI, Roboto). Never a serif.
Code and inference-image names on the web and in the portal are JetBrains
Mono; print uses the Kirk sheet's system monospace stack.

| Element | Web | Print |
|---|---|---|
| Body | 16px / 1.5 / 400 | 10.5pt / 1.5 / 400 |
| Hero H1 | 30px mobile, 60px desktop / 700, tracked | 24pt / 700 |
| Section H2 | 30–36px / 700 | 15pt / 700 + blue underrule |
| Eyebrow / kicker | 10.5–11px / 600 / uppercase / +0.1em, blue on navy, slate-light on white | 9pt / 600 / uppercase |
| Nav links | 15.5px / 400 | — |
| Stat value | 24–30px / 700 | — |

Word and Excel handoff files default to Arial, as in the Kirk system, because
the recipient's machine will not have Inter.

## Logo

Every glyph in these files is outlined Inter (wordmark 800, subline 500,
tracked), so they render identically everywhere with no font dependency.

| File | Use |
|---|---|
| `wordmark.svg` | Claw + "flatclaw" in navy, for light surfaces. The default below 40px. |
| `wordmark-white.svg` | The same in white, for navy and dark grounds. |
| `wordmark-tagline.svg` | Wordmark with the PRIVATE AI PLATFORM subline, for light surfaces at 40px and up. The default at that size. |
| `wordmark-tagline-white.svg` | The same in white. This is the site's header and footer logo and the portal's header logo. |
| `mark.svg` (in `web/public/branding/`) | The claw alone, `currentColor`. Favicons, app icons, avatars, and the hero eyebrow. Never the first or only appearance of the brand. |
| `kirk-flatclaw-lockup.svg` / `-white.svg` | Kirk \| FlatClaw lockup without the subline, for co-branded material below 40px (running headers). |
| `kirk-flatclaw-lockup-tagline.svg` / `-tagline-white.svg` | The lockup with the subline, for covers, slides, share images. |

The claw mark is by Lorc (game-icons.net), CC BY 3.0; see `NOTICE.md` in this
folder.

**Subline rule.** Use a tagline version wherever the logo stands alone at
40px tall or more; below that the subline is unreadable, so use the plain
wordmark or lockup. The PDF running header is 16px tall and therefore always
plain.

**Sizes in use**, so documents and slides can match the site:

| Surface | File | Height |
|---|---|---|
| Site header | tagline wordmark, white | 56px desktop, 48px mobile |
| Site footer | Kirk logo white 24px, hairline divider 40px, tagline wordmark white | 50px |
| Hero eyebrow | mark, white | 28px |
| Portal header | tagline wordmark, white | 45px |
| Portal login | tagline wordmark, navy | 66px |
| Document cover | tagline lockup | 0.65in (about 62px) |
| PDF running header (kirk-skills plugin) | plain lockup | 16px |

**Rules.** Clear space on all sides equals the height of the claw. Minimum
width for the plain wordmark is 96px on screen. Do not recolor the wordmark
outside navy, white, or the blue used on the favicon; do not stretch, rotate,
add effects, or retype "flatclaw" or the subline in another face.

## The Kirk | FlatClaw lockup and the footer block

Co-branded material (proposals, decks, one-pagers delivered by Kirk) carries
both marks. Two arrangements exist:

- **The lockup** (`kirk-flatclaw-lockup*.svg`): the Kirk wordmark on the
  left, a hairline divider, the FlatClaw wordmark on the right, both sized so
  the cap heights match, with the gap between them equal to the height of the
  divider. Use it on covers, slide masters and the running header.
- **The footer block**, as on flatclaw.org: the white Kirk logo at 24px, a
  vertical hairline at 40px, the tagline wordmark at 50px, and beneath it the
  small uppercase link "A Kirk Open Source Community Project". Use this
  pattern on the last slide of a deck, the back page of a document, or any
  surface that needs to say FlatClaw is Kirk's without the lockup's single
  baseline. On narrow widths the two logos stack.

On a light ground use the blue Kirk logo and the navy FlatClaw wordmark; on
navy use the white versions of both. The Kirk logo keeps its orange notch
inside the lockup; that is the one place orange and FlatClaw blue share a
surface.

## Where the tokens live

- **Website** — `web/styles/globals.css` (HSL components, composed with
  Tailwind's `hsl(var(--x))`).
- **Documents** — the `flatclaw-branding` plugin in the kirk-skills
  marketplace (`kirk-brand-flatclaw.css`), which imports the Kirk base sheet
  and swaps the accent to blue.
- **This folder** — `flatclaw-brand.css`, a self-contained stylesheet for any
  other surface (Google Fonts Inter, the tokens above, and a small set of
  document classes).

## Language

American spelling. Dates as `September 3, 2026`. "FlatClaw" is one word with
two capitals in prose; the wordmark itself is lowercase by design. "Private AI
Platform" capitalized as the product name. Things on the platform are agents.
Never a customer name. See "Verbal identity" above for the canonical lines.
