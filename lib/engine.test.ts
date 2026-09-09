import { describe, it, expect } from 'vitest';
import {
  project,
  derive,
  model,
  sanitizeParams,
  ceilingCustomers,
  ceilingRevenue,
  breakevenMonth,
  MAX_CHURN,
  type Params,
} from './engine';

/** The example from the spec. Viable at steady state, dead in month 6. */
const SPEC: Params = {
  startingCash: 18000,
  monthlyBurn: 9500,
  customers: 12,
  price: 400,
  churn: 0.08,
  newPerMonth: 2,
};

describe('project', () => {
  it('returns months + 1 points, starting at month 0 with the untouched initial state', () => {
    const pts = project(SPEC, 24);
    expect(pts).toHaveLength(25);
    expect(pts[0]).toEqual({
      month: 0,
      cash: 18000,
      customers: 12,
      revenue: 4800,
    });
  });

  it('applies churn to the existing base BEFORE new customers land', () => {
    // 10 arrive into an empty base with 50% churn. If churn ran after acquisition
    // we would see 5. The ordering assumption says we see 10.
    const pts = project(
      { startingCash: 0, monthlyBurn: 0, customers: 0, price: 0, churn: 0.5, newPerMonth: 10 },
      1,
    );
    expect(pts[1].customers).toBe(10);
  });

  it('lets cash go negative and keeps plotting it', () => {
    const pts = project(
      { startingCash: 100, monthlyBurn: 1000, customers: 0, price: 0, churn: 0.1, newPerMonth: 0 },
      3,
    );
    expect(pts.map((p) => p.cash)).toEqual([100, -900, -1900, -2900]);
  });

  it('is deterministic', () => {
    expect(project(SPEC)).toEqual(project(SPEC));
  });
});

describe('ceiling', () => {
  it('solves the fixed point of the recurrence', () => {
    expect(ceilingCustomers(SPEC)).toBeCloseTo(25, 10); // 2 / 0.08
    expect(ceilingRevenue(SPEC)).toBeCloseTo(10000, 10);
  });

  it('is actually approached by the loop', () => {
    const pts = project(SPEC, 500);
    expect(pts[500].customers).toBeCloseTo(25, 6);
  });

  it('is Infinity when churn is 0 and signups are positive, without dividing by zero', () => {
    const p = { ...SPEC, churn: 0 };
    expect(ceilingCustomers(p)).toBe(Infinity);
    expect(ceilingRevenue(p)).toBe(Infinity);
  });

  it('does not produce NaN when churn is 0 and price is 0 (Infinity * 0)', () => {
    const p = { ...SPEC, churn: 0, price: 0 };
    expect(ceilingRevenue(p)).toBe(0);
    expect(Number.isNaN(ceilingRevenue(p))).toBe(false);
  });

  it('is the standing base when churn is 0 and nobody new arrives', () => {
    expect(ceilingCustomers({ ...SPEC, churn: 0, newPerMonth: 0 })).toBe(12);
  });

  it('is zero when nobody new arrives and churn is positive', () => {
    expect(ceilingCustomers({ ...SPEC, newPerMonth: 0 })).toBe(0);
  });
});

describe('breakevenMonth', () => {
  it('looks past the 24-month horizon', () => {
    // Needs 23.75 customers, ceiling is 25, so it crosses — but not until month 29.
    expect(breakevenMonth(SPEC)).toBe(29);
  });

  it('is 0 when revenue already covers burn', () => {
    expect(breakevenMonth({ ...SPEC, monthlyBurn: 100 })).toBe(0);
  });

  it('is null when the ceiling sits below burn', () => {
    expect(breakevenMonth({ ...SPEC, monthlyBurn: 50000 })).toBeNull();
  });

  it('is null when the ceiling equals burn exactly (asymptotic, never reached)', () => {
    expect(breakevenMonth({ ...SPEC, monthlyBurn: 10000 })).toBeNull();
  });

  it('is null when price is 0 and burn is positive', () => {
    expect(breakevenMonth({ ...SPEC, price: 0 })).toBeNull();
  });
});

describe('the four outcome classes', () => {
  it('dies_before_arrival: viable at steady state, dead in the trough', () => {
    const { derived } = model(SPEC);
    expect(derived.isViable).toBe(true);
    expect(derived.runoutMonth).toBe(6);
    expect(derived.outcome).toBe('dies_before_arrival');
    expect(derived.breakevenMonth).toBe(29);
    // The trough keeps deepening past the horizon, since breakeven is month 29.
    expect(derived.lowestCashMonth).toBe(24);
  });

  it('never_runs_out: viable and the trough never crosses zero', () => {
    const { derived } = model({ ...SPEC, startingCash: 250000 });
    expect(derived.isViable).toBe(true);
    expect(derived.runoutMonth).toBeNull();
    expect(derived.outcome).toBe('never_runs_out');
  });

  it('structural_runout: not viable, and cash goes negative inside the horizon', () => {
    const { derived } = model({ ...SPEC, churn: 0.25 }); // ceiling 8 customers = $3.2k vs $9.5k burn
    expect(derived.isViable).toBe(false);
    expect(derived.runoutMonth).not.toBeNull();
    expect(derived.outcome).toBe('structural_runout');
  });

  it('plateau_below_burn: not viable, but the cash lasts past month 24', () => {
    const { derived } = model({ ...SPEC, churn: 0.25, startingCash: 500000 });
    expect(derived.isViable).toBe(false);
    expect(derived.runoutMonth).toBeNull();
    expect(derived.outcome).toBe('plateau_below_burn');
  });
});

describe('derive', () => {
  it('reports the FIRST negative month, not the last', () => {
    const p: Params = {
      startingCash: 2000,
      monthlyBurn: 1000,
      customers: 0,
      price: 0,
      churn: 0.1,
      newPerMonth: 0,
    };
    expect(derive(p, project(p, 12)).runoutMonth).toBe(3);
  });

  it('never returns NaN for any derived field on degenerate params', () => {
    const zeros: Params = {
      startingCash: 0,
      monthlyBurn: 0,
      customers: 0,
      price: 0,
      churn: 0,
      newPerMonth: 0,
    };
    for (const v of Object.values(derive(zeros, project(zeros)))) {
      expect(typeof v === 'number' ? Number.isNaN(v) : false).toBe(false);
    }
  });
});

describe('sanitizeParams', () => {
  it('clamps churn to [0, 0.99] so the ceiling is always defined', () => {
    expect(sanitizeParams({ churn: 1 }).churn).toBe(MAX_CHURN);
    expect(sanitizeParams({ churn: 4.2 }).churn).toBe(MAX_CHURN);
    expect(sanitizeParams({ churn: -0.5 }).churn).toBe(0);
  });

  it('floors negatives and replaces junk from a hand-edited URL', () => {
    const p = sanitizeParams({
      startingCash: -5000,
      monthlyBurn: NaN,
      customers: -3,
      price: Infinity as number,
      newPerMonth: undefined,
    });
    expect(p).toEqual({
      startingCash: 0,
      monthlyBurn: 0,
      customers: 0,
      price: 0,
      churn: 0,
      newPerMonth: 0,
    });
  });
});
