import type { MetadataRoute } from "next";

/** Emitted to `out/robots.txt` at build (static export). Allow all; point crawlers at the sitemap. */
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://flatclaw.org/sitemap.xml",
    host: "https://flatclaw.org",
  };
}
