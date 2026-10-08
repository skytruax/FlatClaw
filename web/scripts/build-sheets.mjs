#!/usr/bin/env node
/**
 * Render the build sheets (local vs cloud) to PDF from web/data/builds.json
 * plus the live prices in web/public/builds/prices.json.
 *
 *   node web/scripts/build-sheets.mjs [--out web/public/builds] [--also docs/internal]
 *
 * Letter, FlatClaw brand (navy #22314A, blue #0099FF, Inter). Every sheet is a
 * list of blocks; Chrome lays them out at the page's content width, measures
 * them and packs them onto pages (a table taller than a page is split by rows,
 * header repeated) so nothing ever runs into a footer as prices and text
 * change. A second Chrome pass prints the paginated HTML; the page count in the
 * PDF is checked against what the packer produced.
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = join(here, "..");
const REPO = join(WEB, "..");
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const OUT = resolve(arg("out") ?? join(WEB, "public", "builds"));
const ALSO = arg("also") ? resolve(arg("also")) : null;
const data = JSON.parse(readFileSync(join(WEB, "data", "builds.json"), "utf8"));
const prices = JSON.parse(readFileSync(join(WEB, "public", "builds", "prices.json"), "utf8"));
const asOf = new Date(prices.updatedAt);
const asOfText = asOf.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const wordmark = readFileSync(join(REPO, "branding", "wordmark.svg"), "utf8").replace(/<\?xml[^>]*>/, "");
const usd = (n, cents = false) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: cents ? 2 : 0 });
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function unitPrice(p) {
  const e = p.newegg ? prices.items[p.newegg] : null;
  if (e && e.price != null) return { unit: e.price, live: true, inStock: e.inStock, list: e.list };
  if (typeof p.referencePrice === "number") return { unit: p.referencePrice, live: false };
  return { unit: null, live: false };
}

const CSS = `
:root{--navy:#22314A;--deep:#27436C;--slate:#415A80;--mute:#7F91A8;--blue:#0099FF;--dark-blue:#006BB2;--pale:#EEF5FB;--line:#D9E2EC;}
*{box-sizing:border-box} html,body{margin:0;background:#fff} body{font-family:Inter,system-ui,Arial,sans-serif;color:#22314A;font-size:8.6pt;line-height:1.34;-webkit-font-smoothing:antialiased}
@page{size:letter;margin:0} @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
a{color:var(--dark-blue);text-decoration:none;font-weight:700}
.page{width:8.5in;height:11in;margin:0 auto;padding:.5in .55in .8in;position:relative;overflow:hidden;page-break-after:always}.page:last-child{page-break-after:avoid}
.page::before{content:"";position:absolute;top:0;left:0;right:0;height:6px;background:linear-gradient(90deg,var(--navy),var(--blue))}
#blocks{width:7.4in;margin:0 auto}
.blk{margin:0 0 9px}
.mast{display:flex;justify-content:space-between;align-items:center;padding-bottom:8px;border-bottom:1px solid var(--line);margin-bottom:10px}
.mast svg{height:26px;width:auto}.mast .tag{font-size:7pt;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--dark-blue);text-align:right;line-height:1.45}
.foot{position:absolute;bottom:.4in;left:.55in;right:.55in;padding-top:6px;border-top:1px solid var(--line);display:flex;justify-content:space-between;font-size:7pt;color:var(--mute)}
.eyebrow{color:var(--dark-blue);font-size:7.5pt;font-weight:800;letter-spacing:.16em;text-transform:uppercase}
h1{font-size:22pt;font-weight:800;color:var(--navy);letter-spacing:-.02em;margin:2px 0 4px;line-height:1.05}
.deck{font-size:8.8pt;color:var(--slate);max-width:7in;margin:0 0 7px;line-height:1.45}.deck b{color:var(--navy)}
.glance{background:var(--navy);border-radius:10px;padding:9px 8px;display:grid;grid-template-columns:repeat(5,1fr);margin:4px 0 8px}
.gc{text-align:center;border-right:1px solid rgba(255,255,255,.14);padding:0 6px}.gc:last-child{border-right:none}
.gc .v{font-size:13.5pt;font-weight:800;color:#fff;line-height:1}.gc .l{font-size:6.3pt;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9fb6cf;margin-top:4px}
.vs{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 4px}
.vs .side{border:1px solid var(--line);border-radius:8px;padding:6px 10px;background:#F7FAFD;display:grid;grid-template-columns:auto 1fr;column-gap:12px;align-items:center}.vs .side .k{grid-column:1/-1}.vs .side.cloud{background:#EEF7FF;border-color:var(--blue)}
.vs .k{font-size:6.8pt;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--dark-blue)}.vs .n{font-size:15pt;font-weight:800;color:var(--navy);line-height:1.1;margin:1px 0}.vs .n small{font-size:8pt;color:var(--mute);font-weight:700}.vs .d{font-size:7.6pt;color:var(--slate);line-height:1.4}
h2.sec{display:flex;align-items:baseline;gap:8px;margin:4px 0 6px}h2.sec .n{font-size:8pt;font-weight:800;color:var(--dark-blue)}h2.sec .t{font-size:12pt;font-weight:800;color:var(--navy)}h2.sec .rule{flex:1;height:2px;background:var(--pale);align-self:center}
h2.sec .cont{font-size:7.5pt;font-weight:700;color:var(--mute);text-transform:none;letter-spacing:0}
.two{display:grid;grid-template-columns:1.45fr 1fr;gap:12px;align-items:start}
table{width:100%;border-collapse:collapse;font-size:7.4pt;table-layout:fixed}th{background:var(--navy);color:#fff;font-size:6.6pt;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:4px 7px;text-align:left}
td{padding:2.6px 7px;border-bottom:1px solid var(--line);vertical-align:top;line-height:1.26}td b{color:var(--navy)}
.price{font-weight:800;color:var(--dark-blue);white-space:nowrap;text-align:right}.price small{display:block;font-weight:600;color:var(--mute);font-size:6.4pt;white-space:normal}
tr.chosen td{background:#F1F8FF}tr.alt td{color:var(--slate)}tr.sub td{background:var(--pale);font-weight:800;color:var(--navy)}tr.total td{background:var(--navy);color:#fff;font-weight:800}
.role{font-size:6.4pt;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--mute)}
.tight td{padding:1.7px 7px;line-height:1.22}.tight table{font-size:7.2pt}.tight p.deck{margin-bottom:4px}.tight h2.sec{margin-top:2px}
.card{background:#F7FAFD;border:1px solid var(--line);border-radius:8px;padding:9px 11px;margin-bottom:8px}.card h4{margin:0 0 3px;font-size:7.6pt;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--dark-blue)}.card p{margin:0;font-size:7.9pt;line-height:1.45}
.card.rec{border-color:var(--blue);background:#EEF7FF}.big{font-size:13pt;font-weight:800;color:var(--navy)}.big small{font-size:7.5pt;color:var(--mute);font-weight:700}
.tint{background:var(--pale);border-left:4px solid var(--blue);border-radius:0 7px 7px 0;padding:8px 12px;margin:8px 0 0}.tint .h{font-size:7.5pt;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--dark-blue);margin-bottom:3px}.tint p{margin:0;font-size:8.2pt;line-height:1.5}
.code{background:var(--navy);color:#dbe7f3;border-radius:8px;padding:8px 12px;font-family:'JetBrains Mono','SFMono-Regular',Consolas,monospace;font-size:6.5pt;line-height:1.5;white-space:pre-wrap;word-break:break-all}.code .c{color:#7fb3ff}
.note{font-size:7pt;color:var(--mute);font-style:italic;margin:5px 0 0}
ul.b{margin:4px 0 0;padding-left:0;list-style:none}ul.b li{font-size:7.9pt;line-height:1.45;padding-left:12px;position:relative;margin:2px 0}ul.b li::before{content:"▸";position:absolute;left:0;color:var(--blue)}
`;

/* Runs inside Chrome (first pass, --dump-dom): measures the blocks and packs them onto pages. */
const PACKER = `
(function () {
  const blocks = document.getElementById("blocks");
  if (!blocks) return;
  const mastHTML = blocks.dataset.mast, footTpl = blocks.dataset.foot;
  const probe = document.createElement("div"); probe.className = "page"; probe.innerHTML = mastHTML + '<div class="foot"><span>x</span><span>x</span></div>';
  document.body.appendChild(probe);
  const inner = probe.getBoundingClientRect(), mast = probe.querySelector(".mast").getBoundingClientRect(), foot = probe.querySelector(".foot").getBoundingClientRect();
  const capacity = foot.top - 10 - mast.bottom; // px of content per page
  probe.remove();
  const pages = []; let cur = { h: 0, els: [] };
  const flush = () => { if (cur.els.length) pages.push(cur); cur = { h: 0, els: [] }; };
  const H = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.height + parseFloat(cs.marginBottom) + parseFloat(cs.marginTop); };
  const place = (el) => { const h = H(el); if (cur.h + h > capacity && cur.els.length) flush(); cur.els.push(el); cur.h += h; };
  for (const blk of Array.from(blocks.children)) {
    const h = H(blk);
    const table = blk.querySelector("table");
    if (cur.h + h <= capacity || !table) { place(blk); continue; }
    // a near miss: tighten the table's leading a little and re-measure before splitting
    if (cur.h + h - capacity < 0.08 * h) {
      blk.classList.add("tight");
      const h2 = H(blk);
      if (cur.h + h2 <= capacity) { cur.els.push(blk); cur.h += h2; continue; }
      blk.classList.remove("tight");
    }
    // a table block that does not fit where we are: split it by rows across pages
    const kids = Array.from(blk.children);
    const ti = kids.findIndex((k) => k === table || k.contains(table));
    const pre = kids.slice(0, ti), post = kids.slice(ti + 1);
    const sum = (els) => els.reduce((a, el) => a + H(el), 0);
    const preH = sum(pre), postH = sum(post);
    const rows = Array.from(table.tBodies[0].rows);
    const rowH = rows.map((r) => r.getBoundingClientRect().height);
    const theadH = table.tHead.getBoundingClientRect().height;
    const secH = blk.querySelector("h2.sec") ? H(blk.querySelector("h2.sec")) : 0;
    const blkMargin = parseFloat(getComputedStyle(blk).marginBottom);
    const minFirst = preH + theadH + rowH.slice(0, 3).reduce((a, b) => a + b, 0);
    // a block that fits on a fresh page is only split when it is a long table and the current page
    // still takes a real share of it; small tables and short blocks move whole
    const avgRow = rowH.reduce((a, b) => a + b, 0) / rowH.length;
    if (h <= capacity && (rows.length < 10 || capacity - cur.h < minFirst + 4 * avgRow)) { flush(); place(blk); continue; }
    if (capacity - cur.h < minFirst) flush();
    let i = 0, first = true;
    while (i < rows.length) {
      const headH = first ? preH + theadH : secH + theadH;
      const avail = capacity - cur.h - headH - blkMargin;
      let j = i, used = 0;
      while (j < rows.length && used + rowH[j] <= avail) { used += rowH[j]; j++; }
      if (j === i) { if (cur.els.length) { flush(); continue; } throw new Error("a single table row is taller than a page"); }
      const last = j === rows.length;
      // if the trailing content would not fit under the last rows, leave rows for the next page
      if (last && used + postH > avail) { while (j > i + 1 && used + postH > avail) { j--; used -= rowH[j]; } }
      // widows: never leave fewer than four rows for the next page
      if (j < rows.length && rows.length - j < 4) { while (j > i + 1 && rows.length - j < 4) { j--; used -= rowH[j]; } }
      const reallyLast = j === rows.length;
      const part = blk.cloneNode(true);
      const pkids = Array.from(part.children);
      const ptable = part.querySelector("table");
      Array.from(ptable.tBodies[0].rows).forEach((r, k) => { if (k < i || k >= j) r.remove(); });
      const psec = part.querySelector("h2.sec");
      pkids.forEach((k, idx) => {
        if (k === ptable || k.contains(ptable)) return;
        if (idx < ti) { if (!first && k !== psec) k.remove(); }      // pre: keep on the first chunk, only the heading afterwards
        else if (!reallyLast) k.remove();                              // post: only with the last chunk
      });
      if (!first && psec) psec.querySelector(".t").insertAdjacentHTML("beforeend", ' <span class="cont">(continued)</span>');
      cur.els.push(part);
      cur.h += headH + used + blkMargin + (reallyLast ? postH : 0);
      if (!reallyLast) flush();
      i = j; first = false;
    }
  }
  flush();
  const total = pages.length;
  pages.forEach((pg, n) => {
    const page = document.createElement("div"); page.className = "page";
    page.innerHTML = mastHTML;
    pg.els.forEach((el) => page.appendChild(el));
    page.insertAdjacentHTML("beforeend", footTpl.replace("{n}", String(n + 1)).replace("{total}", String(total)));
    document.body.appendChild(page);
  });
  blocks.remove();
  document.querySelectorAll("script").forEach((s) => s.remove());
  // overflow report: every page's content must end above its footer
  const report = [];
  document.querySelectorAll(".page").forEach((page, n) => {
    const foot = page.querySelector(".foot").getBoundingClientRect();
    let maxBottom = 0;
    for (const el of page.children) if (!el.classList.contains("foot")) maxBottom = Math.max(maxBottom, el.getBoundingClientRect().bottom);
    report.push({ page: n + 1, free: Math.round(foot.top - maxBottom) });
  });
  document.body.dataset.pages = String(total);
  document.body.dataset.report = JSON.stringify(report);
})();
`;

const blk = (html) => `<div class="blk">${html}</div>`;
const sec = (n, title) => `<h2 class="sec"><span class="n">${n}</span><span class="t">${esc(title)}</span><span class="rule"></span></h2>`;
const tableHead = (second) => `<thead><tr><th style="width:13%">Part</th><th>${second}</th><th style="width:19%;text-align:right">Street</th><th style="width:10%">Buy</th></tr></thead>`;

function partRow(p) {
  const { unit, live, inStock, list } = unitPrice(p);
  const line = unit != null ? unit * p.qty : null;
  const buy = p.newegg ? `<a href="https://www.newegg.com/p/${p.newegg}">Newegg ↗</a>` : p.searchUrl ? `<a href="${p.searchUrl}">search ↗</a>` : "—";
  const priceCell = line == null ? `<td class="price">—</td>` : `<td class="price">${usd(line, line < 100)}${p.qty > 1 ? `<small>${usd(unit, true)} each</small>` : ""}${live ? `<small>${inStock ? "in stock" : "out of stock"}${list && list > unit ? ` · list ${usd(list)}` : ""}</small>` : `<small>${esc(p.referenceNote ?? "reference")}</small>`}</td>`;
  return `<tr class="${p.optional ? "alt" : p.tag === "chosen" ? "chosen" : ""}"><td class="role">${esc(p.role)}${p.phase ? `<br>phase ${p.phase}` : ""}${p.optional ? "<br>not in total" : ""}</td><td><b>${esc(p.pick)}</b>${p.qty > 1 ? ` <span style="color:var(--mute)">× ${p.qty}</span>` : ""}<br>${esc(p.why)}</td>${priceCell}<td>${buy}</td></tr>`;
}

function localTotals(variant) {
  const core = variant.parts.filter((p) => !p.optional);
  let sum = 0, liveN = 0;
  const byPhase = {};
  for (const p of core) {
    const { unit, live } = unitPrice(p);
    if (unit == null) continue;
    const line = unit * p.qty;
    sum += line; if (live) liveN++;
    if (p.phase) byPhase[p.phase] = (byPhase[p.phase] ?? 0) + line;
  }
  return { core, sum, liveN, byPhase };
}

function partsTable(variant, { withPhases }) {
  const { core, sum, liveN, byPhase } = localTotals(variant);
  const rows = core.map(partRow).join("");
  const phaseRows = withPhases ? (variant.phases ?? []).map((ph) => {
    const cum = variant.phases.filter((x) => x.n <= ph.n).reduce((s, x) => s + (byPhase[x.n] ?? 0), 0);
    return `<tr class="sub"><td colspan="2">Phase ${ph.n} — ${esc(ph.title)} <span style="font-weight:600;color:var(--slate)">· ${esc(ph.note)}</span></td><td class="price" style="color:var(--navy)">${usd(cum)}</td><td></td></tr>`;
  }).join("") : "";
  return `<table>${tableHead("Pick · why it's here")}<tbody>${rows}${phaseRows}<tr class="total"><td colspan="2">All-in, as specced · ${core.length} parts, ${liveN} priced live from newegg.com on ${esc(asOfText)}${core.length - liveN > 0 ? ", the rest at reference prices" : ""}</td><td class="price" style="color:#fff">${usd(sum)}</td><td></td></tr></tbody></table>`;
}

function altTable(variant, n) {
  const alts = variant.parts.filter((p) => p.optional);
  if (!alts.length) return "";
  return blk(`${sec(n, "Alternatives Newegg has today (not in the total)")}<table>${tableHead("Pick · when to take it")}<tbody>${alts.map(partRow).join("")}</tbody></table>`);
}

function sheetFor(build) {
  const variant = build.local.variants[0];
  const extraVariant = build.local.variants[1];
  const rec = build.cloud.options.find((o) => o.recommended) ?? build.cloud.options[0];
  const cloudCards = build.cloud.options.map((o) => `<div class="card ${o.recommended ? "rec" : ""}"><h4>${o.recommended ? "recommended · " : ""}${esc(o.name)}</h4><div class="big">${usd(o.monthlyWarm)}<small>/mo${o.hourly >= 1 ? ` · $${o.hourly}/hr` : ""}${o.spotHourly ? ` · spot $${o.spotHourly}/hr ≈ ${usd(o.monthlySpot)}/mo` : ""}</small></div><p><b>${esc(o.spec)}.</b> ${o.notes.map(esc).join(" ")}</p>${o.skus?.length ? `<p style="margin-top:3px;font-size:6.8pt;color:var(--mute)">${o.skus.map((k) => `<b>${esc(k.cloud)}</b> <span style="font-family:monospace">${esc(k.sku)}</span>`).join(" · ")}</p>` : ""}</div>`).join("");
  const codeBlock = (list) => (list ?? []).map((s) => `<span class="c"># ${esc(s.label)}</span>\n${esc(s.value)}`).join("\n\n");
  const title = build.id === "glm-5-2" ? "Running GLM-5.2: locally and in the cloud" : "Running Gemma 4 31B: locally and in the cloud";
  const tag = `${esc(build.klass)} · build sheet<br>local + cloud · ${esc(asOfText)}`;
  const mast = `<div class="mast">${wordmark}<div class="tag">${tag}</div></div>`;
  const foot = `<div class="foot"><span>flatclaw.org/builds · the open-source Private AI Platform</span><span>${esc(build.model.name)} build sheet · {n} / {total}</span></div>`;
  const { sum: localSum } = localTotals(variant);

  let n = 0;
  const num = () => String(++n).padStart(2, "0");
  const blocks = [];
  blocks.push(blk(`<div class="eyebrow">${esc(build.klass)}</div><h1>${esc(title)}</h1>
<p class="deck">${esc(build.subtitle)} <b>Model:</b> ${esc(build.model.name)} · ${esc(build.model.params)} · ${esc(build.model.license)} · ${esc(build.model.context)} · ${esc(build.model.footprint)}.</p>
<div class="glance">${build.glance.map((g) => `<div class="gc"><div class="v">${esc(g.v)}</div><div class="l">${esc(g.l)}</div></div>`).join("")}</div>
<div class="vs"><div class="side"><div class="k">Local · bought once</div><div class="n">${usd(localSum)}</div><div class="d">${esc(variant.title.replace(/ \(.*\)$/, ""))} as specced below; Newegg street prices on ${esc(asOfText)}.</div></div>
<div class="side cloud"><div class="k">Cloud · held warm</div><div class="n">${usd(rec.monthlyWarm)}<small>/mo</small></div><div class="d">${esc(rec.name)}, ${esc(rec.spec)}; indicative list price, 24/7, on Azure, AWS, Google Cloud or our reference lane.</div></div></div>`));
  blocks.push(blk(`${sec(num(), `Local — ${variant.title.replace(/ \(.*\)$/, "")}`)}<p class="deck" style="margin-bottom:6px">${esc(variant.summary)}</p>${partsTable(variant, { withPhases: true })}<p class="note">Newegg street prices as read on ${esc(asOfText)}; the live table at flatclaw.org/builds refreshes hourly. Used-market and unlisted parts are marked. Verify at checkout.</p>`));
  const alts = altTable(variant, num());
  if (alts) blocks.push(alts); else n--;
  blocks.push(blk(`${sec(num(), "Cloud — the same checkpoint on the cloud you already run")}${build.cloud.lead ? `<p class="deck" style="margin-bottom:6px">${esc(build.cloud.lead)}</p>` : ""}<div class="two"><div>${cloudCards}<div class="tint"><div class="h">All-in</div><p>${esc(build.cloud.allInNote)}</p></div></div>
<div><div class="card"><h4>Price basis</h4><p>${esc(build.cloud.priceBasis)}</p></div><div class="card"><h4>Notes</h4><ul class="b">${build.cloud.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div></div>`));
  if (build.quantLadder) blocks.push(blk(`${sec(num(), "The quant ladder — what fits where")}<table><thead><tr><th style="width:26%">Tier</th><th style="width:18%">Footprint</th><th>Fits</th></tr></thead><tbody>${build.quantLadder.map((q) => `<tr class="${/chosen/i.test(q.tier) ? "chosen" : ""}"><td><b>${esc(q.tier)}</b></td><td class="price" style="text-align:left">${esc(q.footprint)}</td><td>${esc(q.fits)}</td></tr>`).join("")}</tbody></table>`));
  const software = codeBlock(variant.software);
  blocks.push(blk(`${sec(num(), "Run it")}${software ? `<div class="code">${software}</div>` : ""}<ul class="b">${variant.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`));
  if (extraVariant) {
    const extraSoftware = codeBlock(extraVariant.software);
    blocks.push(blk(`${sec(num(), extraVariant.title)}<p class="deck" style="margin-bottom:6px">${esc(extraVariant.summary)}</p>${partsTable(extraVariant, { withPhases: false })}${extraSoftware ? `<div class="code" style="margin-top:8px">${extraSoftware}</div>` : ""}<ul class="b">${extraVariant.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`));
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>
<div id="blocks" data-mast="${esc(mast).replace(/"/g, "&quot;")}" data-foot="${esc(foot).replace(/"/g, "&quot;")}">${blocks.join("\n")}</div>
<script>${PACKER}</script></body></html>`;
}

mkdirSync(OUT, { recursive: true });
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => existsSync(p));
if (!chrome) throw new Error("no Chrome/Chromium binary found for PDF rendering");
const TMP = mkdtempSync(join(tmpdir(), "build-sheets-"));
const CHROME = ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--window-size=1000,1400", "--virtual-time-budget=4000"];
for (const build of data.builds) {
  const base = build.id === "glm-5-2" ? "FlatClaw-GLM-5.2-Local-vs-Cloud" : "FlatClaw-Gemma-4-31B-Local-vs-Cloud";
  const src = join(TMP, `${base}.blocks.html`);
  const html = join(OUT, `${base}.html`);
  const pdf = join(OUT, `${base}.pdf`);
  writeFileSync(src, sheetFor(build));
  // pass 1: Chrome measures and paginates; the serialized DOM is the static sheet
  const dom = execFileSync(chrome, [...CHROME, "--dump-dom", `file://${src}`], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
  const pagesM = dom.match(/data-pages="(\d+)"/), reportM = dom.match(/data-report="([^"]+)"/);
  if (!pagesM || !reportM) throw new Error(`${base}: the packer did not run (no data-pages on <body>)`);
  const report = JSON.parse(reportM[1].replace(/&quot;/g, '"'));
  const bad = report.filter((r) => r.free < 0);
  if (bad.length) throw new Error(`${base}: content runs into the footer on page(s) ${bad.map((r) => `${r.page} (${-r.free}px over)`).join(", ")}`);
  writeFileSync(html, dom.replace(/ data-pages="\d+"| data-report="[^"]+"/g, "") + "\n");
  // pass 2: print the paginated sheet
  execFileSync(chrome, [...CHROME, "--no-pdf-header-footer", `--print-to-pdf=${pdf}`, `file://${html}`], { stdio: "ignore" });
  const pdfPages = (readFileSync(pdf, "latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  if (pdfPages !== Number(pagesM[1])) throw new Error(`${base}: packer produced ${pagesM[1]} pages but the PDF has ${pdfPages}`);
  console.log(`[build-sheets] ${pdf} · ${pdfPages} pages · free px per page: ${report.map((r) => r.free).join(", ")}`);
  if (ALSO) { mkdirSync(ALSO, { recursive: true }); copyFileSync(pdf, join(ALSO, `${base}.pdf`)); copyFileSync(html, join(ALSO, `${base}.html`)); }
}
