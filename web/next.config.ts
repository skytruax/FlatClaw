import type { NextConfig } from "next";

/**
 * Static export — `next build` writes plain HTML/CSS/JS to `out/`. Upload
 * the contents of `out/` to your cPanel `public_html` (or any static host —
 * GitHub Pages, S3, Cloudflare Pages, Netlify, Vercel). No Node runtime
 * required at runtime.
 *
 *   - `output: "export"`     — emit static files instead of running an SSR server
 *   - `images.unoptimized`   — disable Next's runtime image optimizer (it needs
 *                              a Node server); we serve images as-is
 *   - `trailingSlash`        — `/about/index.html` style URLs map cleanly to
 *                              cPanel's directory-index Apache rules
 */
const config: NextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default config;
