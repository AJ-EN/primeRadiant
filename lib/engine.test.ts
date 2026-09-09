import { describe, it, expect } from 'vitest';
import {
  project,
  derive,
  model,
  validateParams,
  ceilingCustomers,
  ceilingRevenue,
  breakevenMonth,
  BOUNDS,
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

describe('churn at exactly 1', () => {
  // SPEC 3.4 justified a 0.99 clamp by claiming the ceiling is undefined here. It is not:
  // the fixed point of c = c(1 - churn) + n at churn = 1 is exactly n.
  const total: Params = { ...SPEC, churn: 1, newPerMonth: 5 };

  it('has a defined ceiling equal to the monthly signups', () => {
    expect(ceilingCustomers(total)).toBe(5);
    expect(Number.isFinite(ceilingCustomers(total))).toBe(true);
  });

  it('is reached by the loop immediately and stays there', () => {
    const pts = project(total, 6);
    expect(pts[1].customers).toBe(5);
    expect(pts[6].customers).toBe(5);
  });

  it('produces no NaN anywhere in the derived facts', () => {
    for (const v of Object.values(model(total).derived)) {
      expect(typeof v === 'number' ? Number.isNaN(v) : false).toBe(false);
    }
  });
});

describe('validateParams', () => {
  const valid = { ...SPEC };

  it('accepts params inside the bounds and returns them unchanged', () => {
    const result = validateParams(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.params).toEqual(valid);
  });

  it('accepts churn of exactly 1 rather than quietly computing 0.99', () => {
    const result = validateParams({ ...valid, churn: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.params.churn).toBe(1);
  });

  it('rejects churn above 1 instead of clamping it', () => {
    const result = validateParams({ ...valid, churn: 4.2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].key).toBe('churn');
      expect(result.issues[0].message).toContain('100%');
    }
  });

  it('rejects negatives instead of flooring them to zero', () => {
    const result = validateParams({ ...valid, startingCash: -5000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0].key).toBe('startingCash');
      expect(result.issues[0].message).toContain('negative');
    }
  });

  it('rejects junk instead of substituting zero', () => {
    for (const bad of [NaN, Infinity, undefined, null, '400', {}]) {
      const result = validateParams({ ...valid, price: bad as number });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues[0].key).toBe('price');
    }
  });

  it('reports every bad field at once, so a form can show them together', () => {
    const result = validateParams({ startingCash: -1, monthlyBurn: NaN, churn: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const keys = result.issues.map((i) => i.key);
      expect(keys).toContain('startingCash');
      expect(keys).toContain('monthlyBurn');
      expect(keys).toContain('churn');
      // customers, price and newPerMonth are missing entirely, so they are issues too.
      expect(result.issues).toHaveLength(6);
    }
  });

  it('names every key it rejects, so no field can fail silently', () => {
    const result = validateParams({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.key).sort()).toEqual(Object.keys(BOUNDS).sort());
    }
  });
});
