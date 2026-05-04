# FlatClaw — web

Companion informational site for FlatClaw. Lives at **flatclaw.org**.

Stack: Next.js 16 + React 19 + Tailwind 4 (matches the portal's spine so the
two apps feel like one product).

## Pages

- `/` — elaborated README with Hero, what's-in-the-box grid, architecture
  diagram, privacy proof, technology choices, roadmap timeline, and CTAs.
- `/about` — Skyler's bio + LinkedIn / GitHub / email.
- `/partners` — featured partner: Kirk Tech Solutions (custom AI + MCP).

## Design system

Same tokens as the portal (`portal/styles/tokens.css`) — warm green / sage
palette, sage-on-forest CTAs. Branding assets (`mark.svg`,
`wordmark.svg`, `wordmark-white.svg`) are copies from `portal/public/branding/`
to keep the site self-contained and deployable independently.

## Run

```bash
cd web
npm install
npm run dev       # runs on :3001 (portal stays on :3000)
```

## Build for cPanel / any static host

This site is configured for static export — `next build` writes plain
HTML/CSS/JS to `out/`. No Node runtime required at runtime.

```bash
cd web
npm install
npm run build      # produces ./out/
```

Then upload the **contents of `out/`** (not the folder itself) to your
cPanel `public_html` directory via cPanel File Manager or SFTP. URLs
will use trailing-slash style (`/about/`, `/partners/`) which Apache's
`mod_dir` resolves to `index.html` automatically — no `.htaccess`
needed.

Same `out/` directory works on GitHub Pages, Netlify, Cloudflare Pages,
S3 + CloudFront, Vercel — anywhere that serves static files.

> Caveat: this only works because the site has zero server-only features
> (no API routes, no DB, no auth). If we add any of those later we'll
> have to drop the static export and move to a host that runs Node.

## To-do (post-scaffold)

- Replace `public/partners/kirk-tech-solutions.svg` with the official Kirk
  Tech Solutions logo asset when available — the placeholder is a
  typographic mark in the FlatClaw palette.
- Wire up an analytics tag (Plausible / Fathom — privacy-respecting only)
  before launching publicly.
- Add OG/Twitter card images in `public/og/` and reference them from
  `app/layout.tsx` metadata.
- Add a `/security` page mirroring `SECURITY.md`.
