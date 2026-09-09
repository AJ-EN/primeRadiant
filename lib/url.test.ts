import { describe, it, expect } from 'vitest';
import { encodeState, decodeState, fingerprint, changedParams } from './url';
import type { ModelState } from './schema';
import type { Params } from './engine';

const PARAMS: Params = {
  startingCash: 18000,
  monthlyBurn: 9500,
  customers: 12,
  price: 400,
  churn: 0.08,
  newPerMonth: 2,
};

const STATE: ModelState = {
  v: 1,
  s: 'We have 18k in the bank, burn 9.5k a month, 12 customers at $400, 8% churn, 2 new a month',
  p: PARAMS,
  a: [
    'Churn is a flat 8% each month, applied before new signups land.',
    'New customers arrive at a constant 2 per month, not as a growth rate.',
    'Burn stays at $9,500 and does not rise as the customer count grows.',
    'No price change, no second revenue line, no one-off costs.',
  ],
};

describe('encode / decode', () => {
  it('round-trips losslessly', () => {
    expect(decodeState(encodeState(STATE))).toEqual(STATE);
  });

  it('round-trips a fork carrying its origin params', () => {
    const fork: ModelState = {
      ...STATE,
      p: { ...PARAMS, churn: 0.12 },
      o: PARAMS,
      f: fingerprint(PARAMS),
    };
    expect(decodeState(encodeState(fork))).toEqual(fork);
  });

  it('produces a URL-safe payload with no padding', () => {
    expect(encodeState(STATE)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('stays comfortably under the 1500-char switch-to-shortcodes threshold', () => {
    expect(encodeState(STATE).length).toBeLessThan(1500);
  });

  it('survives non-ASCII in the sentence', () => {
    const s = { ...STATE, s: 'We burn ₹9.5L — churn ~8% — café SaaS 🍰' };
    expect(decodeState(encodeState(s))?.s).toBe(s.s);
  });

  it('carries the inferred list, or the badge it drives is decorative', () => {
    const guessed: ModelState = { ...STATE, i: ['churn', 'customers'] };
    expect(decodeState(encodeState(guessed))?.i).toEqual(['churn', 'customers']);
  });

  it('omits the inferred list when nothing was guessed, to keep the payload short', () => {
    expect(encodeState(STATE)).not.toContain('aSI');
    expect(decodeState(encodeState(STATE))?.i).toBeUndefined();
  });

  it('accepts churn of exactly 1 rather than silently drawing 0.99', () => {
    const total: ModelState = { ...STATE, p: { ...PARAMS, churn: 1 } };
    expect(decodeState(encodeState(total))?.p.churn).toBe(1);
  });

  it('rejects out-of-bounds params instead of repairing them', () => {
    for (const bad of [
      { ...PARAMS, churn: 1.5 },
      { ...PARAMS, startingCash: -1 },
      { ...PARAMS, price: 1e13 },
    ]) {
      expect(decodeState(encodeState({ ...STATE, p: bad }))).toBeNull();
    }
  });

  it('returns null instead of throwing on garbage', () => {
    for (const bad of ['', null, undefined, 'not-base64!!', 'YWJj', '%%%%']) {
      expect(decodeState(bad)).toBeNull();
    }
  });

  it('returns null on a well-formed payload that fails the schema', () => {
    const wrongVersion = encodeState({ ...STATE, v: 2 as unknown as 1 });
    expect(decodeState(wrongVersion)).toBeNull();
    const negativeCash = encodeState({ ...STATE, p: { ...PARAMS, startingCash: -1 } });
    expect(decodeState(negativeCash)).toBeNull();
  });
});

describe('fingerprint', () => {
  it('is stable for the same params and differs for different ones', () => {
    expect(fingerprint(PARAMS)).toBe(fingerprint({ ...PARAMS }));
    expect(fingerprint(PARAMS)).not.toBe(fingerprint({ ...PARAMS, churn: 0.09 }));
    expect(fingerprint(PARAMS)).toMatch(/^[a-z0-9]{7,8}$/);
  });
});

describe('changedParams', () => {
  it('lists only what a fork actually moved', () => {
    expect(changedParams(PARAMS, { ...PARAMS, churn: 0.12, price: 450 })).toEqual([
      'price',
      'churn',
    ]);
    expect(changedParams(PARAMS, PARAMS)).toEqual([]);
  });
});
