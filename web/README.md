# FlatClaw — web

Companion informational site for FlatClaw. Lives at **flatclaw.org**.

Stack: Next.js 16 + React 19 + Tailwind 4, static export.

## Pages

- `/` — hero, why-it-exists, cloud partners strip, what's-in-the-box grid,
  featured use case spotlights, architecture diagram, cost, privacy proof,
  technology choices, roadmap timeline, and CTAs.
- `/use-cases` — use case spotlights: anonymized FlatClaw workflows, filterable
  by use case and by industry. Data lives in `lib/useCases.ts`; the selector
  is `components/UseCaseExplorer.tsx` (client component, pure local state).
- `/partners` — cloud partners (Azure, AWS, Google Cloud, Northflank, your own
  hardware; data in `lib/clouds.ts`) and implementation partners.
- `/tokenomics` — per-token API pricing vs a dedicated H100.
- `/about`, `/contributors`.

## Design system

Navy + signal-blue palette aligned with the Kirk Tech Solutions brand system:
navy `#22314A` for dark grounds (header, hero, footer), signal blue `#0099FF`
for CTAs and highlights, dark blue `#006BB2` for hover states and eyebrows on
light backgrounds, slate `#415A80` / mute `#7F91A8` for secondary text. Tokens
are HSL components in `styles/globals.css` and composed with Tailwind's
`hsl(var(--x))`. Branding assets (`mark.svg`, `wordmark.svg`,
`wordmark-white.svg`) are copies from `branding/` so the site stays
self-contained and deployable independently.

## Run

```bash
cd web
npm install
npm run dev       # runs on :3001
```

## Build for cPanel / any static host

`next build` writes plain HTML/CSS/JS to `out/`. No Node runtime required at
runtime. `out/` is generated build output — gitignored, never committed.

```bash
cd web
npm install
npm run build      # produces ./out/
```

Then upload the **contents of `out/`** (not the folder itself) to the
cPanel `public_html` directory for the domain. URLs use trailing-slash style
(`/about/`, `/use-cases/`), which Apache's `mod_dir` resolves to
`index.html` automatically — no `.htaccess` needed. The same `out/` works on
GitHub Pages, Netlify, Cloudflare Pages, S3 + CloudFront, Vercel — anywhere
that serves static files.

> Caveat: this only works because the site has zero server-only features
> (no API routes, no DB, no auth). If we add any of those later we'll have
> to drop the static export and move to a host that runs Node.

## Adding a spotlight or a cloud lane

- Spotlight: add an entry to `SPOTLIGHTS` in `lib/useCases.ts` with at least
  one use-case tag and one industry tag from the filter lists in the same
  file. Keep it anonymized; describe the pattern, not the customer.
- Cloud lane: add an entry to `CLOUD_PARTNERS` in `lib/clouds.ts`. `scripted`
  is only `true` for lanes whose bring-up scripts ship in the repo.

## To-do

- Wire up an analytics tag (privacy-respecting only) before the next launch.
- Add OG/Twitter card images in `public/og/` and reference them from
  `app/layout.tsx` metadata.
- Add a `/security` page mirroring `SECURITY.md`.
