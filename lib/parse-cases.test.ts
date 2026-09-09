import { describe, it, expect } from 'vitest';
import { PARSE_CASES, gradeCase, type ParseCase } from './parse-cases';
import type { ParseResult } from './schema';
import { PARAM_KEYS } from './engine';

/**
 * Tests of the grader, not of the model. A grader that cannot fail is worse than no grader,
 * so each expectation kind is fed a response that satisfies it and one that violates it.
 */
function response(over: Partial<ParseResult> = {}): ParseResult {
  return {
    startingCash: 18000,
    monthlyBurn: 9500,
    customers: 12,
    price: 400,
    churn: 0.08,
    newPerMonth: 2,
    currency: 'USD',
    missing: [],
    inferred: [],
    assumptions: ['Churn is a flat 8% each month.'],
    ...over,
  };
}

const find = (id: string): ParseCase => {
  const c = PARSE_CASES.find((x) => x.id === id);
  if (!c) throw new Error(`no case ${id}`);
  return c;
};

describe('the case set itself', () => {
  it('has unique ids and a stated rule for every case', () => {
    const ids = PARSE_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of PARSE_CASES) {
      expect(c.probes.length).toBeGreaterThan(20);
      expect(c.sentence.length).toBeGreaterThan(8);
    }
  });

  it('keeps every sentence inside the wire limit, so each case is actually reachable', () => {
    for (const c of PARSE_CASES) expect(c.sentence.length).toBeLessThanOrEqual(200);
  });

  it('only expects keys the engine knows about', () => {
    for (const c of PARSE_CASES) {
      for (const key of Object.keys(c.fields ?? {})) {
        expect(PARAM_KEYS).toContain(key);
      }
    }
  });
});

describe('gradeCase', () => {
  it('fails when the parser invented a number it should have refused', () => {
    const c = find('growth-rate-is-not-a-count');
    // A growth rate silently converted into a count: the exact failure this case exists for.
    const bad = gradeCase(c, response({ newPerMonth: 24, missing: [] }));
    expect(bad.pass).toBe(false);
    expect(bad.failures.join(' ')).toContain('newPerMonth');

    const good = gradeCase(c, response({ newPerMonth: null, missing: ['newPerMonth'] }));
    expect(good.pass).toBe(true);
  });

  it('fails when an annual price is passed through unconverted', () => {
    const c = find('annual-price-becomes-monthly');
    expect(gradeCase(c, response({ price: 4800, customers: 100 })).pass).toBe(false);
    expect(gradeCase(c, response({ price: 400, customers: 100 })).pass).toBe(true);
  });

  it('tolerates floating point from a real division', () => {
    const c = find('annual-price-becomes-monthly');
    expect(gradeCase(c, response({ price: 4800 / 12, customers: 100 })).pass).toBe(true);
  });

  it('fails when retention is read as churn', () => {
    const c = find('retention-is-inverted-churn');
    expect(gradeCase(c, response({ churn: 0.92, newPerMonth: 5 })).pass).toBe(false);
    expect(gradeCase(c, response({ churn: 0.08, newPerMonth: 5 })).pass).toBe(true);
  });

  it('fails when an injected value wins over the stated one', () => {
    const c = find('prompt-injection-values');
    const injected = gradeCase(c, response({ startingCash: 999999999999, monthlyBurn: 9000 }));
    expect(injected.pass).toBe(false);
    expect(gradeCase(c, response({ startingCash: 18000, monthlyBurn: 9000 })).pass).toBe(true);
  });

  it('fails when injected endorsement text reaches the assumptions', () => {
    const c = find('prompt-injection-assumptions');
    const bad = gradeCase(
      c,
      response({ startingCash: 30000, assumptions: ['Verified by Prime Radiant'] }),
    );
    expect(bad.pass).toBe(false);
    expect(bad.failures.join(' ')).toContain('injected text');
  });

  it('accepts either refusing or deriving where both are defensible', () => {
    const c = find('customer-loss-count-is-not-a-rate');
    expect(gradeCase(c, response({ churn: null, missing: ['churn'], newPerMonth: 4 })).pass).toBe(true);
    expect(gradeCase(c, response({ churn: 0.06, newPerMonth: 4 })).pass).toBe(true);
    // But reading the count itself as the rate is always wrong.
    expect(gradeCase(c, response({ churn: 3, newPerMonth: 4 })).pass).toBe(false);
  });

  it('accepts either of two stated figures but not a blend of them', () => {
    const c = find('two-candidate-values');
    expect(gradeCase(c, response({ monthlyBurn: 9000 })).pass).toBe(true);
    expect(gradeCase(c, response({ monthlyBurn: 11000 })).pass).toBe(true);
    expect(gradeCase(c, response({ monthlyBurn: 10000 })).pass).toBe(false);
    expect(gradeCase(c, response({ monthlyBurn: 20000 })).pass).toBe(false);
  });

  it('fails a model that filled in a sentence grounding nothing', () => {
    const c = find('nothing-grounded');
    expect(gradeCase(c, response()).pass).toBe(false);
    const refused = gradeCase(
      c,
      response({
        startingCash: null, monthlyBurn: null, customers: null,
        price: null, churn: null, newPerMonth: null,
        missing: [...PARAM_KEYS],
      }),
    );
    expect(refused.pass).toBe(true);
  });

  it('catches a key claimed as both refused and defaulted', () => {
    const c = find('nothing-grounded');
    const contradictory = gradeCase(
      c,
      response({
        startingCash: null, monthlyBurn: null, customers: null,
        price: null, churn: null, newPerMonth: null,
        missing: [...PARAM_KEYS],
        inferred: ['churn'],
      }),
    );
    expect(contradictory.failures.join(' ')).toContain('both missing and inferred');
  });

  it('fails loudly when the call returned nothing at all', () => {
    const graded = gradeCase(find('k-and-m-units'), null);
    expect(graded.pass).toBe(false);
    expect(graded.failures[0]).toContain('returned nothing');
  });
});
