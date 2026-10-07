#!/usr/bin/env node
/**
 * Upload web/public/builds/prices.json and price-history.json to the site's
 * document root (public_html/builds/) through cPanel's UAPI, so the Builds page
 * refreshes without a site redeploy. Credentials from the environment:
 *   CPANEL_SERVER_URL (https://host:2083), CPANEL_USERNAME, CPANEL_API_TOKEN
 * Used by the scheduled price-watch workflow; also runnable by hand.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
// --dir: publish from somewhere other than the repo's public/builds (the local hourly timer keeps
// its state under ~/.local/state so the working tree never gets dirty).
const DIR = arg("dir") ? resolve(arg("dir")) : join(here, "..", "public", "builds");
const server = (process.env.CPANEL_SERVER_URL ?? "").replace(/\/+$/, "");
const user = process.env.CPANEL_USERNAME ?? "";
const token = process.env.CPANEL_API_TOKEN ?? "";
if (!server || !user || !token) throw new Error("CPANEL_SERVER_URL, CPANEL_USERNAME and CPANEL_API_TOKEN are required");
const docroot = process.env.CPANEL_DOCROOT ?? "public_html";

const form = new FormData();
form.set("dir", `${docroot}/builds`);
form.set("overwrite", "1");
for (const [i, name] of ["prices.json", "price-history.json"].entries()) {
  form.set(`file-${i + 1}`, new Blob([readFileSync(join(DIR, name))], { type: "application/json" }), name);
}
const res = await fetch(`${server}/execute/Fileman/upload_files`, { method: "POST", headers: { Authorization: `cpanel ${user}:${token}` }, body: form, signal: AbortSignal.timeout(120_000) });
const body = await res.json().catch(() => ({}));
if (!res.ok || body.status !== 1) throw new Error(`upload failed: HTTP ${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
const uploaded = body.data?.uploads?.map((u) => `${u.file} (${u.status === 1 ? "ok" : "failed"})`).join(", ");
console.log(`[publish-prices] uploaded to ${docroot}/builds: ${uploaded ?? "done"}`);
// verify the live file answers
const live = await fetch("https://flatclaw.org/builds/prices.json", { cache: "no-store", signal: AbortSignal.timeout(30_000) });
const j = await live.json();
console.log(`[publish-prices] live prices.json updatedAt = ${j.updatedAt}`);
