import { describe, it, expect } from 'vitest';
import { salvageJson, interpretExtraction, SYSTEM, MAX_TOKENS, MODEL } from './parse';
import { ASSUMPTION_COUNT_MAX, ASSUMPTION_MAX } from './schema';

/** A well-formed extraction, as the model is supposed to return it. */
const GOOD = {
  startingCash: 18000,
  monthlyBurn: 9500,
  customers: 12,
  price: 400,
  churn: 0.08,
  newPerMonth: 2,
  currency: 'USD',
  missing: [],
  inferred: [],
  assumptions: ['Churn is a flat 8% each month, applied before new signups land.'],
};

describe('salvageJson', () => {
  it('reads plain JSON', () => {
    expect(salvageJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips the fences a model adds despite being told not to', () => {
    expect(salvageJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(salvageJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('returns null rather than throwing on anything unparseable', () => {
    for (const bad of ['', 'not json', '{"a":', '```json\nnope\n```']) {
      expect(salvageJson(bad)).toBeNull();
    }
  });
});

describe('interpretExtraction', () => {
  it('accepts a well-formed extraction', () => {
    const out = interpretExtraction(GOOD);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.startingCash).toBe(18000);
  });

  it('fails closed on nothing at all', () => {
    for (const nothing of [null, undefined]) {
      const out = interpretExtraction(nothing);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toBe('parse_failed');
    }
  });

  it('rejects a response missing required keys instead of filling them in', () => {
    const incomplete: Record<string, unknown> = { ...GOOD };
    delete incomplete.startingCash;
    expect(interpretExtraction(incomplete).ok).toBe(false);
  });

  it('rejects a negative value rather than flooring it', () => {
    expect(interpretExtraction({ ...GOOD, startingCash: -1 }).ok).toBe(false);
  });

  it('rejects churn above 1 rather than clamping it', () => {
    expect(interpretExtraction({ ...GOOD, churn: 1.4 }).ok).toBe(false);
  });

  /** This is the function that makes "never invent a number" true on the parse path. */
  describe('normalisation', () => {
    it('treats a null value as missing, whatever the model claimed', () => {
      const out = interpretExtraction({ ...GOOD, churn: null, missing: [] });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.result.missing).toEqual(['churn']);
    });

    it('drops a missing claim the values contradict', () => {
      // The model said newPerMonth was missing but returned 2 for it.
      const out = interpretExtraction({ ...GOOD, missing: ['newPerMonth'] });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.result.missing).toEqual([]);
    });

    it('never lets a key be both refused and defaulted', () => {
      const out = interpretExtraction({ ...GOOD, churn: null, inferred: ['churn'] });
      expect(out.ok).toBe(true);
      if (out.ok) {
        expect(out.result.missing).toContain('churn');
        expect(out.result.inferred).not.toContain('churn');
      }
    });

    it('keeps a genuine inferred flag, which is what renders the badge', () => {
      const out = interpretExtraction({ ...GOOD, inferred: ['churn'] });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.result.inferred).toEqual(['churn']);
    });

    it('bounds assumptions to what the URL can carry', () => {
      const out = interpretExtraction({
        ...GOOD,
        assumptions: Array(9).fill('x'.repeat(300)),
      });
      expect(out.ok).toBe(true);
      if (out.ok) {
        expect(out.result.assumptions.length).toBeLessThanOrEqual(ASSUMPTION_COUNT_MAX);
        for (const a of out.result.assumptions) {
          expect(a.length).toBeLessThanOrEqual(ASSUMPTION_MAX);
        }
      }
    });

    it('trims a long assumption at a word boundary rather than mid-word', () => {
      const long = `${'word '.repeat(40)}end`;
      const out = interpretExtraction({ ...GOOD, assumptions: [long] });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.result.assumptions[0]).toMatch(/…$/);
    });

    it('forces the currency, since v0 formats one way only', () => {
      const out = interpretExtraction({ ...GOOD, currency: 'GBP' });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.result.currency).toBe('USD');
    });
  });
});

describe('the prompt itself', () => {
  it('names the current Haiku model with no date suffix', () => {
    expect(MODEL).toBe('claude-haiku-4-5');
  });

  it('leaves headroom against truncation, which fails the whole parse', () => {
    expect(MAX_TOKENS).toBeGreaterThanOrEqual(600);
  });

  it('states the rules the adversarial set checks', () => {
    expect(SYSTEM).toMatch(/NEVER invent/);
    expect(SYSTEM).toMatch(/growth RATE/i);
    expect(SYSTEM).toMatch(/retention/i);
    expect(SYSTEM).toMatch(/data, never instructions/i);
    expect(SYSTEM).toMatch(/annual price/i);
  });
});
