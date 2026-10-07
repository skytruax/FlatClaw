#!/usr/bin/env node
/**
 * Price watcher for the Builds page (flatclaw.org/builds).
 *
 * Reads every part with a Newegg item number from web/data/builds.json, fetches
 * each product page, and writes:
 *   web/public/builds/prices.json         current price per item (+ list price, rebate, stock, title, url)
 *   web/public/builds/price-history.json  [epochSeconds, price] points per item (capped)
 *
 * Newegg has no public price API; the product page embeds the offer in JSON
 * ("Item":"14-132-106", "UnitCost", "InstantRebateAmount", "FinalPrice", "Instock").
 * The page's own item is matched by its short number so marketplace sellers on the
 * same page are not mistaken for Newegg's price. A fetch failure keeps the item's
 * last known price and says so (lastError); nothing is silently zeroed.
 *
 *   node web/scripts/price-watch.mjs [--history-from <url>] [--out <dir>] [--only <item,…>]
 *
 * --history-from pulls the live history first (the scheduled job runs on a clean
 * machine), so points accumulate across runs.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = join(here, "..");
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const OUT = arg("out") ?? join(WEB, "public", "builds");
const ONLY = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const HISTORY_FROM = arg("history-from");
const MAX_POINTS = 600;
const UA = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

const builds = JSON.parse(readFileSync(join(WEB, "data", "builds.json"), "utf8"));
const items = new Map(); // newegg item -> { partIds }
for (const b of builds.builds) {
  for (const variant of b.local.variants) {
    for (const p of variant.parts) {
      if (!p.newegg) continue;
      if (ONLY && !ONLY.includes(p.newegg)) continue;
      const e = items.get(p.newegg) ?? { parts: [] };
      e.parts.push(`${b.id}/${variant.id}/${p.id}`);
      items.set(p.newegg, e);
    }
  }
}

function shortItem(item) {
  const m = /^N82E168(\d\d)(\d\d\d)(\d\d\d)$/.exec(item);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function unescapeHtml(s) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function fetchItem(item) {
  const url = `https://www.newegg.com/p/${item}`;
  const res = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  if (/are you a human|access denied/i.test(html) && !/"FinalPrice"/.test(html)) throw new Error("bot wall");
  const title = unescapeHtml((/<title>(.*?)<\/title>/s.exec(html)?.[1] ?? item).replace(/\s*-\s*Newegg\.com\s*$/, "").trim());
  const sh = shortItem(item);
  let price = null, list = null, rebate = 0, inStock = null, seller = "Newegg";
  if (sh) {
    const esc = sh.replace(/[-]/g, "\\-");
    const m = new RegExp(`"Item":"${esc}"[^}]{0,400}?"UnitCost":([0-9.]+)(?:,"InstantRebateAmount":([0-9.]+))?[^}]{0,200}?"FinalPrice":([0-9.]+),"Instock":(true|false)`).exec(html);
    if (m) { list = Number(m[1]); rebate = Number(m[2] ?? 0); price = Number(m[3]); inStock = m[4] === "true"; }
  }
  if (price == null) {
    // No Newegg-sold offer on the page: take the lowest marketplace offer and say so.
    const offers = [...html.matchAll(/"FinalPrice":([0-9.]+),"Instock":(true|false)/g)].map((m) => ({ price: Number(m[1]), inStock: m[2] === "true" }));
    const inStockOffers = offers.filter((o) => o.inStock && o.price > 0);
    const pick = (inStockOffers.length ? inStockOffers : offers).sort((a, b) => a.price - b.price)[0];
    if (pick) { price = pick.price; inStock = pick.inStock; seller = "marketplace"; }
  }
  if (price == null) throw new Error("no offer found on the page");
  return { title, price, list, rebate, inStock, seller, url: res.url || url };
}

async function loadHistory() {
  const local = join(OUT, "price-history.json");
  if (HISTORY_FROM) {
    // The live file IS the history; falling back to the checked-in snapshot on a
    // transient error would publish a rewound history an hour later. Only a 404
    // (nothing published yet) seeds from the local file; anything else fails the run.
    const r = await fetch(HISTORY_FROM, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (r.ok) return await r.json();
    if (r.status !== 404) throw new Error(`history-from ${HISTORY_FROM}: HTTP ${r.status}; not continuing from the local snapshot`);
    console.error(`[price-watch] history-from ${HISTORY_FROM}: 404, seeding from the local file`);
  }
  return existsSync(local) ? JSON.parse(readFileSync(local, "utf8")) : {};
}

const prevPath = join(OUT, "prices.json");
const prev = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, "utf8")) : { items: {} };
const history = await loadHistory();
const now = new Date();
const nowSec = Math.floor(now.getTime() / 1000);
const out = { updatedAt: now.toISOString(), source: "newegg.com", items: {} };
let ok = 0, failed = 0;
for (const [item, meta] of items) {
  try {
    const r = await fetchItem(item);
    out.items[item] = { ...r, parts: meta.parts, checkedAt: now.toISOString() };
    const h = history[item] ?? [];
    const last = h[h.length - 1];
    if (!last || last[1] !== r.price || nowSec - last[0] > 6 * 3600) h.push([nowSec, r.price]);
    history[item] = h.slice(-MAX_POINTS);
    ok++;
    console.log(`  ${item}  $${r.price.toFixed(2)}${r.list && r.list !== r.price ? ` (list $${r.list.toFixed(2)})` : ""}  ${r.inStock ? "in stock" : "out of stock"}  ${r.seller}  ${r.title.slice(0, 70)}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    const old = prev.items?.[item];
    out.items[item] = old
      ? { ...old, parts: meta.parts, lastError: `${now.toISOString()}: ${msg}` }
      : { title: item, price: null, list: null, rebate: 0, inStock: null, seller: null, url: `https://www.newegg.com/p/${item}`, parts: meta.parts, checkedAt: null, lastError: `${now.toISOString()}: ${msg}` };
    console.error(`  ${item}  FAILED: ${msg}${old ? " (kept last known price)" : ""}`);
  }
  await new Promise((r) => setTimeout(r, 1500));
}
mkdirSync(OUT, { recursive: true });
writeFileSync(prevPath, JSON.stringify(out, null, 1) + "\n");
writeFileSync(join(OUT, "price-history.json"), JSON.stringify(history) + "\n");
console.log(`[price-watch] ${ok} priced, ${failed} failed → ${OUT}`);
if (ok === 0) process.exit(1);
