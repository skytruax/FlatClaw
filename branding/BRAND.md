# FlatClaw brand

FlatClaw is a product of [Kirk Tech Solutions](https://kirktechsolutions.com).
Its brand is a **child of the Kirk brand system**: the same typeface, the same
structural palette, the same document and page architecture. What changes is
the accent. Kirk is orange; FlatClaw is blue. Everything else is inherited so
that a FlatClaw page, a Kirk proposal and a co-branded deck read as one family.

The tokens below are the source of truth for the website (`web/styles/globals.css`),
the portal, and any FlatClaw-branded document. `flatclaw-brand.css` in this
folder carries them as CSS custom properties.

## Relationship to Kirk

| | Kirk Tech Solutions | FlatClaw |
|---|---|---|
| Typeface | Inter | Inter (inherited) |
| Dark ground | Navy `#22314A` | Navy `#22314A` (inherited) |
| Headings | Deep `#27436C` | Deep `#27436C` (inherited) |
| Body | Navy `#22314A` · Slate `#415A80` | Same (inherited) |
| Accent | Orange `#FA6900` | **Signal blue `#0099FF`** |
| Deep accent | — | **Dark blue `#006BB2`** (hover, eyebrows on light) |
| Small color on navy | Sky `#51C5FF` | Sky `#51C5FF` (inherited) |
| Logo | KIRK wordmark, orange notch | FlatClaw claw + wordmark |
| Co-branding | — | Kirk \| FlatClaw lockup |

Kirk orange never appears on a FlatClaw surface except inside the Kirk logo
within the lockup. FlatClaw blue never appears on a Kirk surface.

## Color

| Token | Hex | HSL (web tokens) | Role |
|---|---|---|---|
| Navy | `#22314A` | `218 37% 21%` | Dark grounds: header, hero, footer, dark sections; body text on light |
| Deep | `#27436C` | `215 47% 29%` | Major headings, table header fill |
| Slate | `#415A80` | `216 33% 38%` | Subheadings, secondary text |
| Slate light | `#556D91` | `216 26% 45%` | Eyebrow / section-label text |
| Mute | `#7F91A8` | `214 19% 58%` | Captions, metadata, footer text |
| Ink | `#18191F` | `231 13% 11%` | Near-black panels and cards inset on light pages |
| **Blue** | **`#0099FF`** | `204 100% 50%` | **Primary accent:** CTAs, headline highlights, rules, list markers, focus rings |
| **Dark blue** | **`#006BB2`** | `204 100% 35%` | Hover states, links and eyebrows on light backgrounds, button fill where white text needs more contrast |
| Sky | `#51C5FF` | `202 100% 66%` | Small colored text on the navy ground (kickers, labels): AA contrast where blue is not |
| Wash | `#F4F4F4` | `0 0% 96%` | Callout and zebra-row fill |
| Line | `#D8DEE7` | `216 24% 87%` | Hairline rules, card borders |
| Paper | `#FFFFFF` | `0 0% 100%` | Page |

**Contrast rules.** White on `#0099FF` measures about 3:1: acceptable for bold
button labels and display sizes, not for body copy. Use `#006BB2` behind white
body-size text (5.2:1), and Sky `#51C5FF` for anything small and colored on
navy (6.7:1). `#0099FF` on navy passes for large text only, which is exactly
where it is used: the headline accent.

## Type

Inter, every medium. Weights 400 / 600 / 700 / 800. Display sizes take
`letter-spacing: -0.02em`; running text stays at natural tracking. Fallback
chain: Inter → system sans (`-apple-system`, Segoe UI, Roboto). Never a serif.

| Element | Web | Print |
|---|---|---|
| Body | 16px / 1.5 / 400 | 10.5pt / 1.5 / 400 |
| H1 | 48–60px / 700, tracked | 24pt / 700 |
| H2 | 30–36px / 700 | 15pt / 700 + blue underrule |
| Kicker | 11px / 600 / uppercase / +0.12em | 9pt / 600 / uppercase |

Word and Excel handoff files default to Arial, as in the Kirk system, because
the recipient's machine will not have Inter.

## Logo

Three files in this folder:

| File | Use |
|---|---|
| `wordmark.svg` | Claw + "flatclaw" in navy, for light surfaces. The default. |
| `wordmark-white.svg` | The same in white, for navy and dark grounds. |
| `mark.svg` | The claw alone, `currentColor`. Favicons, app icons, avatars, and the hero eyebrow. Never the first or only appearance of the brand. |

The claw mark is by Lorc (game-icons.net), CC BY 3.0; see `NOTICE.md`.

**Rules.** Clear space on all sides equals the height of the claw. Minimum
width for the wordmark is 96px on screen. Do not recolor the wordmark
outside navy, white, or the Kirk blue used on the favicon; do not stretch,
rotate, add effects, or retype "flatclaw" in another face.

## The Kirk | FlatClaw lockup

Co-branded material (proposals, decks, one-pagers delivered by Kirk) carries
both marks: the Kirk wordmark on the left, a hairline divider, the FlatClaw
wordmark on the right, both sized so the cap heights match, with the gap
between them equal to the height of the divider. On a light ground use the
blue Kirk logo and the navy FlatClaw wordmark; on navy use the white versions
of both. The Kirk logo keeps its orange notch inside the lockup; that is the
one place orange and FlatClaw blue share a surface.

## Where the tokens live

- **Website** — `web/styles/globals.css` (HSL components, composed with
  Tailwind's `hsl(var(--x))`).
- **Documents** — Kirk's `kirk-branding` skill with the FlatClaw child
  stylesheet (`kirk-brand-flatclaw.css`), which imports the Kirk base sheet
  and swaps the accent to blue.
- **This folder** — `flatclaw-brand.css`, a self-contained stylesheet for any
  other surface (Google Fonts Inter, the tokens above, and a small set of
  document classes).

## Language

American spelling. Dates as `September 2, 2026`. "FlatClaw" is one word with
two capitals in prose; the wordmark itself is lowercase by design.
