"use client";

interface Point {
  t: string;
  avg: number;
  min: number;
  max: number;
}

/** Line of averages with the min–max band of each bucket, and optional limit lines. */
export function SeriesChart({ points, unit, limits = [], height = 220 }: { points: Point[]; unit?: string | null; limits?: { value: number; label: string }[]; height?: number }) {
  if (!points.length) return <p className="py-10 text-center text-sm text-muted">No readings in this period.</p>;
  const W = 800;
  const H = height;
  const pad = { l: 48, r: 12, t: 10, b: 24 };
  const xs = points.map((p) => new Date(p.t).getTime());
  const values = [...points.flatMap((p) => [p.min, p.max]), ...limits.map((l) => l.value)];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const span = hi - lo;
  lo -= span * 0.05;
  hi += span * 0.05;
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs, x0 + 1);
  const x = (t: number) => pad.l + ((t - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(xs[i]).toFixed(1)},${y(p.avg).toFixed(1)}`).join(" ");
  const band = `${points.map((p, i) => `${i ? "L" : "M"}${x(xs[i]).toFixed(1)},${y(p.max).toFixed(1)}`).join(" ")} ${[...points]
    .reverse()
    .map((p, i) => `L${x(xs[points.length - 1 - i]).toFixed(1)},${y(p.min).toFixed(1)}`)
    .join(" ")} Z`;
  const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];
  const fmt = (t: number) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", ...(x1 - x0 > 86_400_000 ? { day: "numeric", month: "short" } : {}) }).format(new Date(t));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Signal history">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeDasharray="2 4" />
          <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" className="fill-muted text-[10px]">
            {Math.round(v * 10) / 10}
          </text>
        </g>
      ))}
      <path d={band} className="fill-primary/15" />
      <path d={line} fill="none" className="stroke-primary" strokeWidth={1.5} />
      {limits.map((l) => (
        <g key={l.label}>
          <line x1={pad.l} x2={W - pad.r} y1={y(l.value)} y2={y(l.value)} className="stroke-danger" strokeDasharray="6 3" />
          <text x={W - pad.r} y={y(l.value) - 4} textAnchor="end" className="fill-danger text-[10px]">
            {l.label}
          </text>
        </g>
      ))}
      <text x={pad.l} y={H - 6} className="fill-muted text-[10px]">
        {fmt(x0)}
      </text>
      <text x={W - pad.r} y={H - 6} textAnchor="end" className="fill-muted text-[10px]">
        {fmt(x1)}
      </text>
      {unit && (
        <text x={4} y={pad.t + 8} className="fill-muted text-[10px]">
          {unit}
        </text>
      )}
    </svg>
  );
}
