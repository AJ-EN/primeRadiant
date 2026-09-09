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
  /** Fraction of customers lost per month, 0..1. */
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

/** Canonical order. Owned here because this file has no imports; schema.ts re-exports it. */
export const PARAM_KEYS = [
  'startingCash',
  'monthlyBurn',
  'customers',
  'price',
  'churn',
  'newPerMonth',
] as const;

export type ParamKey = (typeof PARAM_KEYS)[number];

/**
 * How far past the horizon we are willing to look for breakeven. 50 years.
 * Cheap enough to run on every slider frame, long enough that "null" honestly means never.
 */
const BREAKEVEN_SEARCH_CAP = 600;

/**
 * The single source of truth for what a valid number is. Zod refines against this rather
 * than restating it, so there is one place a bound can be wrong.
 *
 * Churn runs to a full 1.0. SPEC 3.4 claimed a clamp at 0.99 was needed because "at exactly
 * 1 the ceiling is undefined", but that is not true: the recurrence is c = c(1 - churn) + n,
 * whose fixed point at churn = 1 is exactly n, and the closed form n / churn returns n. There
 * is no division by zero. The clamp only ever did one thing, which was silently compute with
 * a number the user did not type.
 */
export const BOUNDS: Record<ParamKey, { min: number; max: number; label: string }> = {
  startingCash: { min: 0, max: 1e12, label: 'Starting cash' },
  monthlyBurn: { min: 0, max: 1e12, label: 'Monthly burn' },
  customers: { min: 0, max: 1e9, label: 'Customers today' },
  price: { min: 0, max: 1e9, label: 'Price per customer' },
  churn: { min: 0, max: 1, label: 'Monthly churn' },
  newPerMonth: { min: 0, max: 1e9, label: 'New customers per month' },
};

export type FieldIssue = { key: ParamKey; message: string };

export type ParamsResult =
  | { ok: true; params: Params }
  | { ok: false; issues: FieldIssue[] };

const describeMax = (key: ParamKey): string =>
  key === 'churn' ? '100%' : BOUNDS[key].max.toLocaleString('en-US');

/**
 * Reject and explain. Never repair.
 *
 * This replaced `sanitizeParams`, which floored negatives to 0 and clamped churn, so a
 * founder who typed 100% churn saw 100% in the field while the chart was drawn at 99%. A
 * tool whose entire pitch is that its assumptions are visible cannot quietly substitute its
 * own numbers for yours. Every caller now has to decide what to show when input is wrong,
 * which is the point.
 */
export function validateParams(
  raw: Partial<Record<ParamKey, unknown>>,
): ParamsResult {
  const issues: FieldIssue[] = [];
  const params = {} as Params;

  for (const key of PARAM_KEYS) {
    const value = raw[key];
    const { min, max, label } = BOUNDS[key];

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ key, message: `${label} needs to be a number.` });
      continue;
    }
    if (value < min) {
      issues.push({ key, message: `${label} cannot be negative.` });
      continue;
    }
    if (value > max) {
      issues.push({ key, message: `${label} cannot be more than ${describeMax(key)}.` });
      continue;
    }
    params[key] = value;
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, params };
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

/**
 * What the UI calls, once per slider frame. Takes params that already passed
 * `validateParams` at their entry boundary; it does not repair, because repairing here is
 * exactly how a number the user never typed ends up on the chart.
 */
export function model(params: Params, months = DEFAULT_MONTHS) {
  const points = project(params, months);
  return { params, points, derived: derive(params, points) };
}
