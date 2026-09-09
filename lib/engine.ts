/**
 * The entire predictive core. Deterministic arithmetic, no dependencies, no imports.
 * If this file is wrong, nothing else in the product matters.
 *
 * Keep it that way: no React, no formatting, no rounding. Callers round for display.
 */

export type Params = {
  /** Cash in the bank at month 0. */
  startingCash: number;
  /** Fixed monthly cost. Does not scale with customers — see ASSUMPTION_NOTES. */
  monthlyBurn: number;
  /** Active paying customers at month 0. Fractional allowed downstream. */
  customers: number;
  /** Revenue per customer per month. */
  price: number;
  /** Fraction of customers lost per month, 0..0.99. */
  churn: number;
  /** New customers acquired per month, absolute count (not a growth rate). */
  newPerMonth: number;
};

export type Point = {
  month: number;
  cash: number;
  customers: number;
  revenue: number;
};

export type Outcome =
  /** Viable at steady state, and cash never goes negative inside the horizon. Boring. */
  | 'never_runs_out'
  /** Viable at steady state, but cash goes negative first. The reason this product exists. */
  | 'dies_before_arrival'
  /** Not viable, and cash goes negative inside the horizon. Structural, not timing. */
  | 'structural_runout'
  /** Not viable, but survives the horizon. Slow death just past the edge of the chart. */
  | 'plateau_below_burn';

export type Derived = {
  /** Steady-state customer count: the fixed point of the recurrence. Infinity when churn is 0. */
  ceilingCustomers: number;
  /** Revenue at the ceiling. */
  ceilingRevenue: number;
  /** Does the business clear its burn at steady state, ignoring the trough entirely? */
  isViable: boolean;
  /** First month where cash < 0, or null if it never happens inside the horizon. */
  runoutMonth: number | null;
  /** First month where revenue >= burn. Looks past the horizon, so it can exceed `months`. */
  breakevenMonth: number | null;
  /** Lowest cash across the horizon, and when. The trough is the thing that kills you. */
  lowestCash: number;
  lowestCashMonth: number;
  /** Last point on the chart. */
  finalCash: number;
  finalCustomers: number;
  finalRevenue: number;
  outcome: Outcome;
};

export const DEFAULT_MONTHS = 24;

/** Churn of exactly 1 makes the ceiling undefined; above 0.99 the model is noise anyway. */
export const MAX_CHURN = 0.99;

/**
 * How far past the horizon we are willing to look for breakeven. 50 years.
 * Cheap enough to run on every slider frame, long enough that "null" honestly means never.
 */
const BREAKEVEN_SEARCH_CAP = 600;

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/** URLs are user-editable and the LLM is a parser, not an oracle. Never trust raw params. */
export function sanitizeParams(raw: Partial<Params>): Params {
  const num = (v: unknown, fallback = 0) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;

  return {
    startingCash: Math.max(0, num(raw.startingCash)),
    monthlyBurn: Math.max(0, num(raw.monthlyBurn)),
    customers: Math.max(0, num(raw.customers)),
    price: Math.max(0, num(raw.price)),
    churn: clamp(num(raw.churn), 0, MAX_CHURN),
    newPerMonth: Math.max(0, num(raw.newPerMonth)),
  };
}

/**
 * The loop.
 *
 * ORDERING ASSUMPTION: churn hits the existing base BEFORE new customers land, so a
 * customer acquired in month m cannot churn in month m. This is a modeling choice, not
 * a fact, and it materially shifts the curve. It is surfaced in the UI on purpose.
 */
export function project(p: Params, months = DEFAULT_MONTHS): Point[] {
  let customers = p.customers;
  let cash = p.startingCash;

  const out: Point[] = [
    { month: 0, cash, customers, revenue: customers * p.price },
  ];

  for (let m = 1; m <= months; m++) {
    customers = customers * (1 - p.churn) + p.newPerMonth;
    const revenue = customers * p.price;
    cash = cash + revenue - p.monthlyBurn;
    out.push({ month: m, cash, customers, revenue });
  }

  return out;
}

/**
 * Steady-state customer count. Solves c = c(1 - churn) + newPerMonth.
 * churn = 0 means nobody ever leaves, so the base grows without bound (or sits still).
 */
export function ceilingCustomers(p: Params): number {
  if (p.churn <= 0) return p.newPerMonth > 0 ? Infinity : p.customers;
  return p.newPerMonth / p.churn;
}

/** Infinity * 0 is NaN, which would poison every downstream comparison. Handle it explicitly. */
export function ceilingRevenue(p: Params): number {
  const c = ceilingCustomers(p);
  if (!Number.isFinite(c)) return p.price > 0 ? Infinity : 0;
  return c * p.price;
}

/**
 * First month where revenue covers burn. Deliberately searches past the 24-month horizon:
 * "you run out in month 6, and you would not have broken even until month 29" is the
 * single most useful sentence this engine can produce.
 */
export function breakevenMonth(p: Params, cap = BREAKEVEN_SEARCH_CAP): number | null {
  if (p.monthlyBurn <= 0) return 0;
  if (p.price <= 0) return null;

  const target = p.monthlyBurn / p.price;
  if (p.customers >= target) return 0;
  // Customers move monotonically toward the ceiling, so a ceiling below target is never.
  if (ceilingCustomers(p) < target) return null;

  let c = p.customers;
  for (let m = 1; m <= cap; m++) {
    c = c * (1 - p.churn) + p.newPerMonth;
    if (c >= target) return m;
  }
  return null;
}

export function derive(p: Params, points: Point[]): Derived {
  const ceilC = ceilingCustomers(p);
  const ceilR = ceilingRevenue(p);
  const isViable = ceilR > p.monthlyBurn;

  // Cash is allowed to go negative and stay plotted. Going negative is the whole point.
  const runout = points.find((pt) => pt.cash < 0);
  const runoutMonth = runout ? runout.month : null;

  let lowest = points[0];
  for (const pt of points) if (pt.cash < lowest.cash) lowest = pt;

  const last = points[points.length - 1];

  const outcome: Outcome = isViable
    ? runoutMonth === null
      ? 'never_runs_out'
      : 'dies_before_arrival'
    : runoutMonth === null
      ? 'plateau_below_burn'
      : 'structural_runout';

  return {
    ceilingCustomers: ceilC,
    ceilingRevenue: ceilR,
    isViable,
    runoutMonth,
    breakevenMonth: breakevenMonth(p),
    lowestCash: lowest.cash,
    lowestCashMonth: lowest.month,
    finalCash: last.cash,
    finalCustomers: last.customers,
    finalRevenue: last.revenue,
    outcome,
  };
}

/** What the UI calls. One pass, sanitized, on every slider frame. */
export function model(raw: Partial<Params>, months = DEFAULT_MONTHS) {
  const params = sanitizeParams(raw);
  const points = project(params, months);
  return { params, points, derived: derive(params, points) };
}
