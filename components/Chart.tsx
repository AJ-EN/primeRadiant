'use client';

/**
 * Hand-rolled SVG. Deliberately not Recharts (SPEC 7.3): full control over annotation
 * placement, no re-render overhead on drag, one fewer dependency.
 *
 * Pure function of props. No state, no effects, no memo — it must be cheap enough to
 * re-render synchronously on every `input` event while a finger is down.
 *
 * Two coordinate spaces, not one. Text inside an SVG scales with the viewBox, so the 700-wide
 * desktop plot squeezed into a 311px phone rendered its labels at about 5px. The compact
 * space is sized so it renders near 1:1 on a phone, which keeps every annotation legible.
 * Which one is used is a CSS decision in ModelClient, so there is no hook, no hydration
 * mismatch and no flash of the wrong size.
 */
import type { Point } from '@/lib/engine';
import { money } from '@/lib/format';

type Geometry = {
  W: number;
  H: number;
  /** The curve lives between these, matching the first and last gridline in the design. */
  top: number;
  bottom: number;
  /** Horizontal reach, in viewBox units, over which a label is considered to be colliding. */
  reach: number;
  labelSize: number;
  zeroSize: number;
  curveWidth: number;
  ghostWidth: number;
  markerRadius: number;
};

const FULL: Geometry = {
  W: 700,
  H: 284,
  top: 10,
  bottom: 270,
  reach: 100,
  labelSize: 12,
  zeroSize: 11,
  curveWidth: 2.5,
  ghostWidth: 2,
  markerRadius: 5.5,
};

/** Sized so a 375px phone renders this at roughly 1:1, give or take 15%. */
const COMPACT: Geometry = {
  W: 300,
  H: 210,
  top: 8,
  bottom: 196,
  reach: 45,
  labelSize: 11,
  zeroSize: 10,
  curveWidth: 2,
  ghostWidth: 1.5,
  markerRadius: 4.5,
};

type Rect = { x: number; y: number; w: number; h: number };

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/** 1, 2, 2.5, 5, 10 x 10^k. Nice steps keep the y-domain from jittering mid-drag. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * mag;
}

/**
 * The y-domain always contains zero: the crossing is the point of the chart, and cash below
 * zero is never clamped away (SPEC 3.4). Rounding the bounds outward to a nice step means the
 * axis only moves when it genuinely has to, so the curve does not swim while you drag.
 */
function yDomain(series: Point[][]): { lo: number; hi: number } {
  let lo = 0;
  let hi = 0;
  for (const s of series)
    for (const p of s) {
      if (p.cash < lo) lo = p.cash;
      if (p.cash > hi) hi = p.cash;
    }
  if (lo === hi) hi = lo + 1;
  const step = niceStep((hi - lo) / 4);
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step };
}

function boxDistance(b: Rect, px: number, py: number): number {
  const dx = Math.max(b.x - px, 0, px - (b.x + b.w));
  const dy = Math.max(b.y - py, 0, py - (b.y + b.h));
  return Math.hypot(dx, dy);
}

function boxesOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * The one genuinely fiddly piece. Label position is computed from the curve, never from
 * fixed coordinates, because the curve moves under it on every slider frame.
 *
 * Four candidate corners around the anchor. Score each by clearance to the nearest curve
 * point within `reach` horizontally, disqualify any that overlaps a label already placed,
 * and take the roomiest. Ties break toward above-right, where a reader looks first.
 */
function placeLabel(
  geo: Geometry,
  curves: { x: number; y: number }[][],
  cx: number,
  cy: number,
  bw: number,
  bh: number,
  taken: Rect[],
): Rect {
  const pad = geo === COMPACT ? 8 : 14;
  const candidates = [
    { x: cx + pad, y: cy - pad - bh },
    { x: cx + pad, y: cy + pad },
    { x: cx - pad - bw, y: cy - pad - bh },
    { x: cx - pad - bw, y: cy + pad },
  ];

  let best: Rect = {
    x: clamp(cx + pad, 0, geo.W - bw),
    y: clamp(cy - pad - bh, 0, geo.H - bh),
    w: bw,
    h: bh,
  };
  let bestClearance = -Infinity;

  for (const c of candidates) {
    const box: Rect = {
      x: clamp(c.x, 2, geo.W - bw - 2),
      y: clamp(c.y, 2, geo.H - bh - 2),
      w: bw,
      h: bh,
    };
    if (taken.some((t) => boxesOverlap(box, t))) continue;

    let clearance = Infinity;
    for (const curve of curves)
      for (const p of curve) {
        if (Math.abs(p.x - cx) > geo.reach) continue;
        clearance = Math.min(clearance, boxDistance(box, p.x, p.y));
      }
    if (clearance > bestClearance) {
      bestClearance = clearance;
      best = box;
    }
  }
  return best;
}

/** Rough text width at a given size. Good enough to keep labels off the curve. */
const textWidth = (s: string, size: number) => s.length * size * 0.54;

export type ChartProps = {
  points: Point[];
  /** The parent model's curve on a fork. Drawn grey and dashed, behind the current one. */
  ghost?: Point[] | null;
  runoutMonth: number | null;
  months: number;
  /** Phone-sized coordinate space. Chosen by CSS in ModelClient, never by a media hook. */
  compact?: boolean;
};

export default function Chart({ points, ghost, runoutMonth, months, compact }: ChartProps) {
  const geo = compact ? COMPACT : FULL;
  const { lo, hi } = yDomain(ghost ? [points, ghost] : [points]);

  const x = (m: number) => (m / months) * geo.W;
  const y = (cash: number) =>
    geo.top + (1 - (cash - lo) / (hi - lo)) * (geo.bottom - geo.top);

  const yZero = y(0);
  const toXY = (p: Point) => ({ x: x(p.month), y: y(p.cash) });
  const curve = points.map(toXY);
  const ghostCurve = ghost ? ghost.map(toXY) : null;

  const line = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  const area = `${line(curve)} L${geo.W},${yZero.toFixed(2)} L0,${yZero.toFixed(2)} Z`;

  /** Exact zero crossing, interpolated between the last solvent month and the first that isn't. */
  const crossingX = (series: Point[], month: number | null): number | null => {
    if (month === null || month <= 0) return null;
    const before = series[month - 1];
    const after = series[month];
    const t = before.cash / (before.cash - after.cash);
    return x(before.month) + t * (x(after.month) - x(before.month));
  };

  const crossX = crossingX(points, runoutMonth);
  const ghostRunout = ghost ? (ghost.find((p) => p.cash < 0)?.month ?? null) : null;
  const ghostCrossX = ghost ? crossingX(ghost, ghostRunout) : null;

  /** When the fork survives, the trough is the story instead of a crossing. */
  let trough = points[0];
  for (const p of points) if (p.cash < trough.cash) trough = p;
  const showTrough = runoutMonth === null && !!ghost && trough.month > 0;

  const taken: Rect[] = [];
  const allCurves = ghostCurve ? [curve, ghostCurve] : [curve];
  const labelH = geo.labelSize + 4;

  // Phone-width labels are shorter: the full phrase would span half the plot.
  const runoutText =
    runoutMonth === null ? '' : compact ? `month ${runoutMonth}` : `month ${runoutMonth} · out of cash`;
  const runoutBox =
    crossX !== null
      ? placeLabel(geo, allCurves, crossX, yZero, textWidth(runoutText, geo.labelSize), labelH, taken)
      : null;
  if (runoutBox) taken.push(runoutBox);

  const troughText = showTrough
    ? compact
      ? money(trough.cash)
      : `lowest point · ${money(trough.cash)}`
    : '';
  const troughBox = showTrough
    ? placeLabel(
        geo,
        allCurves,
        x(trough.month),
        y(trough.cash),
        textWidth(troughText, geo.labelSize),
        labelH,
        taken,
      )
    : null;
  if (troughBox) taken.push(troughBox);

  const ghostText = compact ? 'original' : 'original ran out here';
  const ghostBox =
    ghostCrossX !== null && ghost
      ? placeLabel(
          geo,
          allCurves,
          ghostCrossX,
          yZero,
          textWidth(ghostText, geo.labelSize),
          labelH,
          taken,
        )
      : null;

  const summary =
    runoutMonth !== null
      ? `Cash projection over ${months} months. Cash crosses zero in month ${runoutMonth}.`
      : `Cash projection over ${months} months. Cash stays above zero throughout.`;

  const axisTicks = [0, months / 4, months / 2, (months * 3) / 4, months].map(Math.round);
  const clipAbove = compact ? 'pr-above-c' : 'pr-above';
  const clipBelow = compact ? 'pr-below-c' : 'pr-below';

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${geo.W} ${geo.H}`}
        className="block h-auto w-full select-none"
        role="img"
        aria-label={summary}
      >
        <defs>
          <clipPath id={clipAbove}>
            <rect x={0} y={0} width={geo.W} height={Math.max(0, yZero)} />
          </clipPath>
          <clipPath id={clipBelow}>
            <rect x={0} y={yZero} width={geo.W} height={Math.max(0, geo.H - yZero)} />
          </clipPath>
        </defs>

        {[0, 1, 2, 3, 4].map((i) => {
          const gy = geo.top + (i * (geo.bottom - geo.top)) / 4;
          return (
            <line key={i} x1={0} x2={geo.W} y1={gy} y2={gy} stroke="var(--line)" strokeWidth={1} />
          );
        })}

        <path d={area} fill="var(--accent-soft)" clipPath={`url(#${clipAbove})`} />
        <path d={area} fill="var(--danger-soft)" clipPath={`url(#${clipBelow})`} />

        {/* Zero line, dashed, in the same orange as everything that means "you are dead". */}
        <line
          x1={0}
          x2={geo.W}
          y1={yZero}
          y2={yZero}
          stroke="var(--danger)"
          strokeWidth={1}
          strokeDasharray="4 4"
          opacity={0.75}
        />

        {ghostCurve && (
          <path
            d={line(ghostCurve)}
            fill="none"
            stroke="var(--ghost)"
            strokeWidth={geo.ghostWidth}
            strokeDasharray="5 4"
            strokeLinecap="round"
          />
        )}

        {/* One path, drawn twice, clipped at zero — solvent in teal, underwater in orange. */}
        <path
          d={line(curve)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={geo.curveWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          clipPath={`url(#${clipAbove})`}
        />
        <path
          d={line(curve)}
          fill="none"
          stroke="var(--danger)"
          strokeWidth={geo.curveWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          clipPath={`url(#${clipBelow})`}
        />

        {ghostCrossX !== null && (
          <circle
            cx={ghostCrossX}
            cy={yZero}
            r={geo.markerRadius * 0.75}
            fill="var(--surface)"
            stroke="var(--ghost)"
            strokeWidth={2}
          />
        )}
        {crossX !== null && (
          <circle
            cx={crossX}
            cy={yZero}
            r={geo.markerRadius}
            fill="var(--surface)"
            stroke="var(--danger)"
            strokeWidth={2.5}
          />
        )}
        {showTrough && (
          <circle
            cx={x(trough.month)}
            cy={y(trough.cash)}
            r={geo.markerRadius * 0.9}
            fill="var(--surface)"
            stroke="var(--accent)"
            strokeWidth={2.5}
          />
        )}

        <text
          x={geo.W - 2}
          y={yZero - 7}
          textAnchor="end"
          fontSize={geo.zeroSize}
          fontWeight={600}
          fill="var(--danger)"
        >
          $0
        </text>

        {runoutBox && (
          <text
            x={runoutBox.x}
            y={runoutBox.y + geo.labelSize}
            fontSize={geo.labelSize}
            fontWeight={600}
            fill="var(--danger)"
          >
            {runoutText}
          </text>
        )}
        {troughBox && (
          <text
            x={troughBox.x}
            y={troughBox.y + geo.labelSize}
            fontSize={geo.labelSize}
            fontWeight={600}
            fill="var(--accent)"
          >
            {troughText}
          </text>
        )}
        {ghostBox && (
          <text
            x={ghostBox.x}
            y={ghostBox.y + geo.labelSize}
            fontSize={geo.labelSize}
            fontWeight={500}
            fill="var(--ink-3)"
          >
            {ghostText}
          </text>
        )}
      </svg>

      <div
        className={`mt-3 flex justify-between text-ink-3 ${compact ? 'text-[11px]' : 'text-[12px]'}`}
      >
        {axisTicks.map((m, i) => (
          <span key={i} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {m === 0 ? 'now' : compact ? `m${m}` : `month ${m}`}
          </span>
        ))}
      </div>
    </div>
  );
}
