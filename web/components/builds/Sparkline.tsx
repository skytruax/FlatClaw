"use client";

/** A tiny price-history line; the last point is marked. Renders nothing for fewer than two points. */
export function Sparkline({ points, width = 84, height = 22 }: { points: [number, number][] | undefined; width?: number; height?: number }) {
  if (!points || points.length < 2) return <span className="inline-block" style={{ width, height }} aria-hidden />;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
  const pad = 2;
  const coords = points.map(([x, y]) => [pad + ((x - minX) / spanX) * (width - 2 * pad), height - pad - ((y - minY) / spanY) * (height - 2 * pad)] as const);
  const d = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  const up = ys[ys.length - 1] > ys[0];
  const color = up ? "hsl(var(--brand-accent))" : ys[ys.length - 1] < ys[0] ? "#16a34a" : "hsl(var(--fc-fg-muted))";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block align-middle" aria-label={`price history, ${points.length} points`}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2" fill={color} />
    </svg>
  );
}
