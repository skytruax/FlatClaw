import type { MetadataRoute } from "next";
import { SPOTLIGHTS } from "@/lib/useCases";

/**
 * Sitemap for flatclaw.org. Emitted to `out/sitemap.xml` at build time
 * (`output: "export"` in next.config.ts → static file, no runtime needed).
 *
 * URLs use a trailing slash to match `trailingSlash: true` (cPanel
 * directory-index URLs like /about/). Add a route here when you add a page.
 */
const BASE = "https://flatclaw.org";

// Route slug, change frequency, priority. "" = home.
const ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "", changeFrequency: "weekly", priority: 1.0 },
  { path: "use-cases", changeFrequency: "weekly", priority: 0.9 },
  { path: "about", changeFrequency: "monthly", priority: 0.8 },
  { path: "tokenomics", changeFrequency: "monthly", priority: 0.8 },
  { path: "services", changeFrequency: "monthly", priority: 0.8 },
  { path: "contributors", changeFrequency: "monthly", priority: 0.6 },
];

// Required for `output: "export"` — make the route fully static.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const pages = ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: path ? `${BASE}/${path}/` : `${BASE}/`,
    lastModified,
    changeFrequency,
    priority,
  }));
  const spotlights: MetadataRoute.Sitemap = SPOTLIGHTS.map((s) => ({
    url: `${BASE}/use-cases/${s.id}/`,
    lastModified,
    changeFrequency: "monthly",
    priority: 0.7,
  }));
  return [...pages, ...spotlights];
}
