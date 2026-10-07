"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, TrendingDown, TrendingUp, Minus, CheckCircle2, AlertTriangle, Server, Cpu } from "lucide-react";
import { Sparkline } from "./Sparkline";
import { priceDelta, relativeTime, useLivePrices, usd, type LivePrices } from "./prices";
import type { BuildsData, Build, Part, Variant, Recipe } from "./types";

type TabKey = "recipes" | "references";

export function BuildsExplorer({ data }: { data: BuildsData }) {
  const [tab, setTab] = useState<TabKey>("recipes");
  useEffect(() => {
    const fromHash = () => setTab(window.location.hash === "#references" ? "references" : "recipes");
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const go = (t: TabKey) => {
    setTab(t);
    history.replaceState(null, "", t === "references" ? "#references" : "#recipes");
  };
  const live = useLivePrices();

  return (
    <div>
      <div className="sticky top-16 z-20 -mx-5 px-5 py-3 bg-[hsl(var(--fc-bg-primary))/0.92] backdrop-blur border-b border-[hsl(var(--fc-bg-tertiary))]">
        <div className="mx-auto max-w-6xl flex flex-wrap items-center gap-2">
          <TabButton active={tab === "recipes"} onClick={() => go("recipes")} icon={<Server className="w-4 h-4" />} label="Build recipes" sub="what we run and what we learned" />
          <TabButton active={tab === "references"} onClick={() => go("references")} icon={<Cpu className="w-4 h-4" />} label="Local and cloud references" sub="parts, live prices, cloud plans, side by side" />
          <div className="ml-auto">
            <PriceStatus live={live} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl py-10">
        {tab === "recipes" ? <RecipesTab recipes={data.recipes} /> : <ReferencesTab data={data} live={live} />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label, sub }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; sub: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "flex items-center gap-3 rounded-lg px-4 py-2 text-left transition ring-1 " +
        (active
          ? "bg-[hsl(var(--brand-primary))] text-white ring-[hsl(var(--brand-primary))]"
          : "bg-[hsl(var(--fc-bg-surface))] text-[hsl(var(--fc-fg-primary))] ring-[hsl(var(--fc-bg-tertiary))] hover:ring-[hsl(var(--brand-accent))]")
      }
    >
      <span className={active ? "text-[hsl(var(--brand-accent))]" : "text-[hsl(var(--fc-fg-muted))]"}>{icon}</span>
      <span>
        <span className="block text-sm font-semibold leading-tight">{label}</span>
        <span className={"block text-[11px] leading-tight " + (active ? "text-white/70" : "text-[hsl(var(--fc-fg-muted))]")}>{sub}</span>
      </span>
    </button>
  );
}

function PriceStatus({ live }: { live: LivePrices }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const updated = live.prices?.updatedAt;
  return (
    <div className="flex items-center gap-2 text-[11px] text-[hsl(var(--fc-fg-muted))]">
      <span className={"inline-block w-2 h-2 rounded-full " + (live.error ? "bg-red-500" : live.loading ? "bg-amber-400 animate-pulse" : "bg-emerald-500")} aria-hidden />
      <span>
        {live.error ? `prices unavailable (${live.error})` : updated ? `Newegg prices as of ${new Date(updated).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · checked ${relativeTime(live.fetchedAt?.toISOString() ?? null)}` : "loading prices…"}
      </span>
      <button type="button" onClick={live.refresh} className="inline-flex items-center gap-1 rounded-md px-2 py-1 ring-1 ring-[hsl(var(--fc-bg-tertiary))] hover:text-[hsl(var(--fc-fg-primary))] hover:ring-[hsl(var(--brand-accent))]" aria-label="Refresh prices">
        <RefreshCw className={"w-3 h-3 " + (live.loading ? "animate-spin" : "")} /> refresh
      </button>
    </div>
  );
}

/* ───────────────────────────── Tab 1: recipes ───────────────────────────── */

function RecipesTab({ recipes }: { recipes: Recipe[] }) {
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-[hsl(var(--fc-fg-secondary))] leading-relaxed">
        These are the configurations FlatClaw actually runs or has measured, with the numbers that mattered and the lessons that cost
        time. Cloud figures are list prices on the reference lane; local figures come from the live parts tables on the other tab.
      </p>
      <div className="grid md:grid-cols-2 gap-5">
        {recipes.map((r) => (
          <article key={r.id} id={r.id} className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-6 flex flex-col">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-primary))]">{r.eyebrow}</div>
            <h3 className="mt-1 text-xl font-bold tracking-tight text-[hsl(var(--fc-fg-primary))]">{r.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">{r.summary}</p>
            <dl className="mt-4 grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1.5 text-sm">
              {r.facts.map((f) => (
                <div key={f.k} className="contents">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--fc-fg-muted))] pt-0.5">{f.k}</dt>
                  <dd className="text-[hsl(var(--fc-fg-primary))] font-mono text-[12.5px] leading-snug break-words">{f.v}</dd>
                </div>
              ))}
            </dl>
            {r.bullets.length > 0 && (
              <ul className="mt-4 space-y-1.5 text-sm text-[hsl(var(--fc-fg-secondary))]">
                {r.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span className="text-[hsl(var(--brand-accent))] mt-0.5">▸</span>
                    <span className="leading-relaxed">{b}</span>
                  </li>
                ))}
              </ul>
            )}
            {r.links?.length ? (
              <div className="mt-auto pt-4">
                {r.links.map((l) => (
                  <a key={l.href} href={l.href} className="text-sm font-semibold text-[hsl(var(--brand-primary))] hover:text-[hsl(var(--brand-accent))]">
                    {l.label} →
                  </a>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────── Tab 2: local and cloud references ─────────────────────── */

function ReferencesTab({ data, live }: { data: BuildsData; live: LivePrices }) {
  return (
    <div className="space-y-16">
      <p className="max-w-3xl text-[hsl(var(--fc-fg-secondary))] leading-relaxed">{data.priceNote}</p>
      {data.builds.map((b) => (
        <BuildSheet key={b.id} build={b} live={live} />
      ))}
    </div>
  );
}

function BuildSheet({ build, live }: { build: Build; live: LivePrices }) {
  const [variantId, setVariantId] = useState(build.local.variants[0].id);
  const variant = build.local.variants.find((v) => v.id === variantId) ?? build.local.variants[0];
  return (
    <section id={build.id} className="scroll-mt-32">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-primary))]">{build.klass}</div>
      <h2 className="mt-1 text-2xl md:text-3xl font-bold tracking-tight text-[hsl(var(--fc-fg-primary))]">{build.title}</h2>
      <p className="mt-2 max-w-3xl text-[hsl(var(--fc-fg-secondary))] leading-relaxed">{build.subtitle}</p>

      <div className="mt-5 grid grid-cols-2 sm:grid-cols-5 gap-px bg-[hsl(var(--brand-primary))] rounded-xl overflow-hidden">
        {build.glance.map((g) => (
          <div key={g.l} className="bg-[hsl(var(--brand-primary))] px-4 py-3 text-center">
            <div className="text-xl font-extrabold text-white leading-none">{g.v}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-white/60">{g.l}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid xl:grid-cols-[1.9fr_1fr] gap-6 items-start">
        {/* Local */}
        <div className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-[hsl(var(--fc-fg-primary))]">Local</h3>
            {build.local.variants.length > 1 && (
              <div className="flex gap-1 rounded-lg bg-[hsl(var(--fc-bg-tertiary))/0.5] p-1">
                {build.local.variants.map((v) => (
                  <button key={v.id} type="button" onClick={() => setVariantId(v.id)} className={"rounded-md px-3 py-1 text-xs font-semibold " + (v.id === variant.id ? "bg-white text-[hsl(var(--brand-primary))] shadow-sm" : "text-[hsl(var(--fc-fg-secondary))] hover:text-[hsl(var(--fc-fg-primary))]")}>
                    {v.title.replace(/ \(.*\)$/, "")}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-1 text-sm font-semibold text-[hsl(var(--fc-fg-primary))]">{variant.title}</div>
          <p className="mt-1 text-sm leading-relaxed text-[hsl(var(--fc-fg-secondary))]">{variant.summary}</p>
          <PartsTable variant={variant} live={live} />
          {variant.software?.length ? (
            <div className="mt-4 rounded-lg bg-[hsl(var(--brand-primary))] p-4 text-[11.5px] font-mono text-white/90 space-y-2 overflow-x-auto">
              {variant.software.map((s) => (
                <div key={s.label}>
                  <span className="text-[hsl(var(--brand-accent))]"># {s.label}</span>
                  <br />
                  {s.value}
                </div>
              ))}
            </div>
          ) : null}
          <ul className="mt-4 space-y-1.5 text-sm text-[hsl(var(--fc-fg-secondary))]">
            {variant.notes.map((n) => (
              <li key={n} className="flex gap-2">
                <span className="text-[hsl(var(--brand-accent))] mt-0.5">▸</span>
                <span className="leading-relaxed">{n}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Cloud */}
        <div className="bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-5 md:p-6">
          <h3 className="text-lg font-bold text-[hsl(var(--fc-fg-primary))]">Cloud</h3>
          <div className="mt-3 space-y-3">
            {build.cloud.options.map((o) => (
              <div key={o.plan} className={"rounded-lg p-3.5 ring-1 " + (o.recommended ? "ring-[hsl(var(--brand-accent))] bg-[hsl(var(--brand-accent))/0.06]" : "ring-[hsl(var(--fc-bg-tertiary))]")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--fc-fg-muted))]">{o.provider}{o.recommended ? " · recommended" : ""}</div>
                    <div className="font-mono text-sm font-semibold text-[hsl(var(--fc-fg-primary))]">{o.plan}</div>
                    <div className="text-xs text-[hsl(var(--fc-fg-secondary))]">{o.gpus}{o.vram !== "—" ? ` · ${o.vram}` : ""}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-extrabold text-[hsl(var(--fc-fg-primary))] leading-none">{usd(o.monthlyWarm)}<span className="text-xs font-semibold text-[hsl(var(--fc-fg-muted))]">/mo</span></div>
                    <div className="text-[11px] text-[hsl(var(--fc-fg-muted))]">{o.hourly >= 1 ? `$${o.hourly}/hr warm` : `~$${o.hourly.toFixed(2)}/hr`}{o.spotHourly ? ` · spot $${o.spotHourly}/hr ≈ ${usd(o.monthlySpot ?? 0)}/mo` : ""}</div>
                  </div>
                </div>
                <ul className="mt-2 space-y-1 text-xs text-[hsl(var(--fc-fg-secondary))]">
                  {o.notes.map((n) => (
                    <li key={n} className="leading-relaxed">{n}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg bg-[hsl(var(--brand-primary))] p-4 text-white">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))]">All-in</div>
            <div className="mt-1 text-sm leading-relaxed">{build.cloud.allInNote}</div>
          </div>
          <div className="mt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--fc-fg-muted))]">The same shape elsewhere</div>
            <ul className="mt-1.5 space-y-1.5 text-xs text-[hsl(var(--fc-fg-secondary))]">
              {build.cloud.elsewhere.map((e) => (
                <li key={e.cloud + e.sku}>
                  <span className="font-semibold text-[hsl(var(--fc-fg-primary))]">{e.cloud}</span> · <span className="font-mono">{e.sku}</span> — {e.note}
                </li>
              ))}
            </ul>
          </div>
          <ul className="mt-4 space-y-1.5 text-sm text-[hsl(var(--fc-fg-secondary))]">
            {build.cloud.notes.map((n) => (
              <li key={n} className="flex gap-2">
                <span className="text-[hsl(var(--brand-accent))] mt-0.5">▸</span>
                <span className="leading-relaxed">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {build.quantLadder?.length ? (
        <div className="mt-6 bg-[hsl(var(--fc-bg-surface))] rounded-xl ring-1 ring-[hsl(var(--fc-bg-tertiary))] p-5 md:p-6">
          <h3 className="text-base font-bold text-[hsl(var(--fc-fg-primary))]">The quant ladder — what fits where</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--fc-fg-muted))]">
                  <th className="py-1.5 pr-3">Tier</th>
                  <th className="py-1.5 pr-3">Footprint</th>
                  <th className="py-1.5">Fits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--fc-bg-tertiary))]">
                {build.quantLadder.map((q) => (
                  <tr key={q.tier} className={/chosen/i.test(q.tier) ? "bg-[hsl(var(--brand-accent))/0.06]" : ""}>
                    <td className="py-1.5 pr-3 font-semibold text-[hsl(var(--fc-fg-primary))]">{q.tier}</td>
                    <td className="py-1.5 pr-3 font-mono text-[hsl(var(--brand-primary))]">{q.footprint}</td>
                    <td className="py-1.5 text-[hsl(var(--fc-fg-secondary))]">{q.fits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {build.sheetPdf ? (
        <div className="mt-4 text-sm">
          <a href={build.sheetPdf} className="font-semibold text-[hsl(var(--brand-primary))] hover:text-[hsl(var(--brand-accent))]">Download this sheet as a PDF →</a>
        </div>
      ) : null}
    </section>
  );
}

function partPrice(p: Part, live: LivePrices): { unit: number | null; source: "live" | "reference" | "none"; entry?: ReturnType<typeof entryFor> } {
  const entry = entryFor(p, live);
  if (entry && entry.price != null) return { unit: entry.price, source: "live", entry };
  if (typeof p.referencePrice === "number") return { unit: p.referencePrice, source: "reference", entry: entry ?? undefined };
  return { unit: null, source: "none", entry: entry ?? undefined };
}
function entryFor(p: Part, live: LivePrices) {
  return p.newegg ? live.prices?.items[p.newegg] ?? null : null;
}

function PartsTable({ variant, live }: { variant: Variant; live: LivePrices }) {
  const rows = variant.parts;
  const totals = useMemo(() => {
    const core = rows.filter((p) => !p.optional);
    let sum = 0, liveCount = 0, priced = 0;
    const byPhase: Record<number, number> = {};
    for (const p of core) {
      const { unit, source } = partPrice(p, live);
      if (unit == null) continue;
      priced++;
      if (source === "live") liveCount++;
      const line = unit * p.qty;
      sum += line;
      if (p.phase) byPhase[p.phase] = (byPhase[p.phase] ?? 0) + line;
    }
    return { sum, liveCount, priced, core: core.length, byPhase };
  }, [rows, live]);

  return (
    <div className="mt-4">
      <ul className="md:hidden divide-y divide-[hsl(var(--fc-bg-tertiary))] border-y border-[hsl(var(--fc-bg-tertiary))]">
        {rows.map((p) => {
          const { unit, source, entry } = partPrice(p, live);
          const hist = p.newegg ? live.history[p.newegg] : undefined;
          const delta = source === "live" ? priceDelta(hist, unit) : null;
          const href = entry?.url ?? p.searchUrl ?? (p.newegg ? `https://www.newegg.com/p/${p.newegg}` : undefined);
          return (
            <li key={p.id} className={"py-3 " + (p.optional ? "opacity-80" : "")}>
              <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wide text-[hsl(var(--fc-fg-muted))]">
                <span>{p.role}</span>
                {p.phase ? <span className="font-normal normal-case tracking-normal">phase {p.phase}</span> : null}
                {p.optional ? <span className="rounded px-1.5 py-0.5 text-[9.5px] bg-[hsl(var(--fc-bg-tertiary))/0.6] text-[hsl(var(--fc-fg-secondary))]">not in total</span> : null}
              </div>
              <div className="mt-1 flex items-start justify-between gap-3">
                <div className="font-semibold text-[hsl(var(--fc-fg-primary))] leading-snug">{p.pick}{p.qty > 1 ? <span className="text-[hsl(var(--fc-fg-muted))] font-normal"> × {p.qty}</span> : null}</div>
                <div className="text-right shrink-0">
                  {unit != null ? (
                    <>
                      <div className="font-extrabold text-[hsl(var(--fc-fg-primary))] whitespace-nowrap">{usd(unit * p.qty, unit * p.qty < 100)}</div>
                      {p.qty > 1 ? <div className="text-[10.5px] text-[hsl(var(--fc-fg-muted))] whitespace-nowrap">{usd(unit, true)} each</div> : null}
                    </>
                  ) : (
                    <div className="text-xs text-[hsl(var(--fc-fg-muted))]">{live.loading ? "…" : "no price"}</div>
                  )}
                </div>
              </div>
              <div className="mt-1 text-[12px] leading-relaxed text-[hsl(var(--fc-fg-secondary))]">{p.why}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px]">
                {source === "live" ? (
                  <>
                    <span className={"inline-flex items-center gap-1 font-semibold " + (delta ? (delta.abs > 0 ? "text-red-600" : "text-emerald-600") : "text-[hsl(var(--fc-fg-muted))]")}>
                      {delta ? (delta.abs > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />) : <Minus className="w-3 h-3" />}
                      {delta ? `${delta.abs > 0 ? "+" : ""}${usd(delta.abs * p.qty)} (${delta.pct > 0 ? "+" : ""}${delta.pct.toFixed(1)}%)` : "no change"}
                    </span>
                    <span className={"inline-flex items-center gap-1 " + (entry?.inStock ? "text-emerald-700" : "text-amber-700")}>
                      {entry?.inStock ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                      {entry?.inStock ? "in stock" : "out of stock"}{entry?.seller === "marketplace" ? " · marketplace" : ""}
                    </span>
                    <Sparkline points={hist} width={64} height={18} />
                  </>
                ) : unit != null ? (
                  <span className="text-[hsl(var(--fc-fg-muted))]">{p.referenceNote ?? "reference price"}</span>
                ) : null}
                {entry?.lastError ? <span className="text-amber-700">last check failed; showing the last known price</span> : null}
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-[hsl(var(--brand-primary))]">
                    {p.newegg ? "Newegg" : "search"} <ExternalLink className="w-3 h-3" />
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
        {variant.phases?.map((ph) => {
          const cumulative = variant.phases!.filter((x) => x.n <= ph.n).reduce((s, x) => s + (totals.byPhase[x.n] ?? 0), 0);
          return (
            <li key={`ph-${ph.n}`} className="py-2.5 flex items-start justify-between gap-3 bg-[hsl(var(--fc-bg-tertiary))/0.35] -mx-5 px-5">
              <div className="text-xs text-[hsl(var(--fc-fg-secondary))]"><span className="text-[10.5px] font-semibold uppercase tracking-wide text-[hsl(var(--fc-fg-muted))]">Phase {ph.n} · </span><span className="font-semibold text-[hsl(var(--fc-fg-primary))]">{ph.title}</span> — {ph.note}</div>
              <div className="font-bold text-[hsl(var(--fc-fg-primary))] whitespace-nowrap">{usd(cumulative)}</div>
            </li>
          );
        })}
        <li className="py-3 flex items-center justify-between gap-3 bg-[hsl(var(--brand-primary))] text-white -mx-5 px-5">
          <div className="text-xs text-white/80"><span className="text-[10.5px] font-semibold uppercase tracking-wide text-white/70">All-in · </span>{totals.core} parts · {totals.liveCount} live{totals.priced - totals.liveCount > 0 ? `, ${totals.priced - totals.liveCount} reference` : ""}{totals.priced < totals.core ? `, ${totals.core - totals.priced} unpriced` : ""}</div>
          <div className="text-lg font-extrabold whitespace-nowrap">{usd(totals.sum)}</div>
        </li>
      </ul>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm table-fixed">
          <colgroup>
            <col className="w-[13%]" />
            <col className="w-[50%]" />
            <col className="w-[17%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--fc-fg-muted))]">
              <th className="py-2 pr-3">Part</th>
              <th className="py-2 pr-3">Pick · why it's here</th>
              <th className="py-2 pr-3 text-right">Street</th>
              <th className="py-2 pr-3">Trend</th>
              <th className="py-2">Buy</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--fc-bg-tertiary))]">
            {rows.map((p) => {
              const { unit, source, entry } = partPrice(p, live);
              const hist = p.newegg ? live.history[p.newegg] : undefined;
              const delta = source === "live" ? priceDelta(hist, unit) : null;
              return (
                <tr key={p.id} className={p.optional ? "opacity-80" : p.tag === "chosen" ? "bg-[hsl(var(--brand-accent))/0.05]" : ""}>
                  <td className="py-2.5 pr-3 align-top">
                    <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[hsl(var(--fc-fg-muted))] leading-tight">{p.role}</div>
                    {p.phase ? <div className="text-[10px] text-[hsl(var(--fc-fg-muted))]">phase {p.phase}</div> : null}
                    {p.optional ? <div className="mt-0.5 inline-block rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide bg-[hsl(var(--fc-bg-tertiary))/0.6] text-[hsl(var(--fc-fg-secondary))]">not in total</div> : null}
                  </td>
                  <td className="py-2.5 pr-3 align-top">
                    <div className="font-semibold text-[hsl(var(--fc-fg-primary))] leading-snug">{p.pick}{p.qty > 1 ? <span className="text-[hsl(var(--fc-fg-muted))] font-normal"> × {p.qty}</span> : null}</div>
                    <div className="mt-0.5 text-[12px] leading-relaxed text-[hsl(var(--fc-fg-secondary))]">{p.why}</div>
                    {entry?.lastError ? <div className="mt-0.5 text-[10.5px] text-amber-700">last check failed ({entry.lastError.split(": ").slice(1).join(": ")}); showing the last known price</div> : null}
                  </td>
                  <td className="py-2.5 pr-3 align-top text-right whitespace-nowrap">
                    {unit != null ? (
                      <>
                        <div className="font-extrabold text-[hsl(var(--fc-fg-primary))]">{usd(unit * p.qty, unit * p.qty < 100)}</div>
                        {p.qty > 1 ? <div className="text-[10.5px] text-[hsl(var(--fc-fg-muted))]">{usd(unit, true)} each</div> : null}
                        {source === "live" ? (
                          <>
                            {entry?.list && entry.list > unit ? <div className="text-[10.5px] text-[hsl(var(--fc-fg-muted))] line-through">{usd(entry.list * p.qty)}</div> : null}
                            <div className={"mt-0.5 inline-flex items-center gap-1 text-[10.5px] font-semibold " + (delta ? (delta.abs > 0 ? "text-red-600" : "text-emerald-600") : "text-[hsl(var(--fc-fg-muted))]")}>
                              {delta ? (delta.abs > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />) : <Minus className="w-3 h-3" />}
                              {delta ? `${delta.abs > 0 ? "+" : ""}${usd(delta.abs * p.qty)} (${delta.pct > 0 ? "+" : ""}${delta.pct.toFixed(1)}%)` : "no change"}
                            </div>
                            <div className={"mt-0.5 inline-flex items-center gap-1 text-[10px] " + (entry?.inStock ? "text-emerald-700" : "text-amber-700")}>
                              {entry?.inStock ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                              {entry?.inStock ? "in stock" : "out of stock"}{entry?.seller === "marketplace" ? " · marketplace seller" : ""}
                            </div>
                          </>
                        ) : (
                          <div className="text-[10.5px] text-[hsl(var(--fc-fg-muted))] whitespace-normal leading-snug">{p.referenceNote ?? "reference price"}</div>
                        )}
                      </>
                    ) : (
                      <div className="text-xs text-[hsl(var(--fc-fg-muted))]">{live.loading ? "…" : "no price"}</div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 align-top">
                    <Sparkline points={hist} width={72} />
                  </td>
                  <td className="py-2.5 align-top whitespace-nowrap">
                    <a href={entry?.url ?? p.searchUrl ?? (p.newegg ? `https://www.newegg.com/p/${p.newegg}` : "#")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-[hsl(var(--brand-primary))] hover:text-[hsl(var(--brand-accent))]">
                      {p.newegg ? "Newegg" : p.searchUrl ? "search" : "—"} <ExternalLink className="w-3 h-3" />
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {variant.phases?.map((ph) => {
              const cumulative = variant.phases!.filter((x) => x.n <= ph.n).reduce((s, x) => s + (totals.byPhase[x.n] ?? 0), 0);
              return (
                <tr key={ph.n} className="bg-[hsl(var(--fc-bg-tertiary))/0.35]">
                  <td className="py-2 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-[hsl(var(--fc-fg-muted))]">Phase {ph.n}</td>
                  <td className="py-2 pr-3 text-xs text-[hsl(var(--fc-fg-secondary))]"><span className="font-semibold text-[hsl(var(--fc-fg-primary))]">{ph.title}</span> — {ph.note}</td>
                  <td className="py-2 pr-3 text-right font-bold text-[hsl(var(--fc-fg-primary))] whitespace-nowrap">{usd(cumulative)}</td>
                  <td colSpan={2} />
                </tr>
              );
            })}
            <tr className="bg-[hsl(var(--brand-primary))] text-white">
              <td className="py-2.5 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-white/70">All-in</td>
              <td className="py-2.5 pr-3 text-xs text-white/80">
                {totals.core} parts · {totals.liveCount} priced live from Newegg{totals.priced - totals.liveCount > 0 ? `, ${totals.priced - totals.liveCount} at reference prices` : ""}
                {totals.priced < totals.core ? `, ${totals.core - totals.priced} unpriced` : ""}
              </td>
              <td className="py-2.5 pr-3 text-right text-lg font-extrabold whitespace-nowrap">{usd(totals.sum)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
