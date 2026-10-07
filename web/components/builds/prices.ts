"use client";

/**
 * Live Newegg prices for the Builds page. The static site has no server, so a
 * scheduled job (web/scripts/price-watch.mjs) writes /builds/prices.json and
 * /builds/price-history.json next to the page; this module fetches them with a
 * cache-busting query, recomputes on an interval, and derives the change since
 * the previous recorded price for each item.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface PriceEntry {
  title: string;
  price: number | null;
  list: number | null;
  rebate: number;
  inStock: boolean | null;
  seller: "Newegg" | "marketplace" | null;
  url: string;
  checkedAt: string | null;
  lastError?: string;
}
export interface PricesFile {
  updatedAt: string;
  source: string;
  items: Record<string, PriceEntry>;
}
export type History = Record<string, [number, number][]>;

export interface LivePrices {
  prices: PricesFile | null;
  history: History;
  loading: boolean;
  error: string | null;
  fetchedAt: Date | null;
  refresh: () => void;
}

export const REFRESH_MS = 10 * 60_000;

export function useLivePrices(): LivePrices {
  const [prices, setPrices] = useState<PricesFile | null>(null);
  const [history, setHistory] = useState<History>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const bust = `?t=${Date.now()}`;
      const [p, h] = await Promise.all([
        fetch(`/builds/prices.json${bust}`, { cache: "no-store" }),
        fetch(`/builds/price-history.json${bust}`, { cache: "no-store" }),
      ]);
      if (!p.ok) throw new Error(`prices.json: HTTP ${p.status}`);
      setPrices((await p.json()) as PricesFile);
      setHistory(h.ok ? ((await h.json()) as History) : {});
      setError(null);
      setFetchedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    timer.current = window.setInterval(() => void load(), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  return { prices, history, loading, error, fetchedAt, refresh: load };
}

/** Change versus the previous recorded price point (the point before the latest). */
export function priceDelta(points: [number, number][] | undefined, current: number | null): { abs: number; pct: number; since: number } | null {
  if (!points || current == null || points.length < 2) return null;
  const prev = points[points.length - 2];
  if (!prev || prev[1] === current) return null;
  return { abs: current - prev[1], pct: ((current - prev[1]) / prev[1]) * 100, since: prev[0] };
}

export function usd(n: number, cents = false): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: cents ? 2 : 0 });
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
