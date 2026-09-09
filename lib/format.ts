/**
 * Display only. Nothing here is ever called from inside the projection loop —
 * money is rounded for display, never in the arithmetic (SPEC 3.4).
 */

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Exact, grouped: $18,000. For inputs and precise readouts. */
export function money(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  return usd.format(Math.round(n));
}

/** Compact, for axis ticks and slider values where width is scarce: $18k, -$2.5k, $1.2M. */
export function moneyShort(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${trim(a / 1_000_000)}M`;
  if (a >= 1_000) return `${sign}$${trim(a / 1_000)}k`;
  return `${sign}$${Math.round(a)}`;
}

function trim(n: number): string {
  const r = n < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  return String(r);
}

export function percent(fraction: number, dp = 1): string {
  return `${(fraction * 100).toFixed(dp).replace(/\.0$/, '')}%`;
}

/** Customer counts are fractional in the model but nobody thinks in 13.04 customers. */
export function count(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  return n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

export function monthLabel(m: number): string {
  return m === 1 ? 'month 1' : `month ${m}`;
}
