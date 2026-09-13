import { describe, it, expect } from 'vitest';
import { extractFromSentence } from './extract';
import { PARSE_CASES, gradeCase } from './parse-cases';
import { PARAM_KEYS } from './engine';
import { evalGate } from './eval-gate';

/**
 * The live half of T12. Costs money, so it never runs by accident.
 *
 *   pnpm eval:parse        (reads ANTHROPIC_API_KEY from .env.local)
 *
 * `pnpm test` skips this entirely. Everything the parse path does *without* the network is
 * covered offline in parse.test.ts and parse-cases.test.ts, which is what runs in CI.
 *
 * Roughly 13 calls at Haiku rates, well under a cent per run.
 */
const gate = evalGate(process.env);
const LIVE = gate.kind === 'run';

/**
 * Requested but not runnable. This has to be a *failing test* rather than a skip: the command
 * exiting 0 with 13 skips is exactly what let docs/DEPLOY.md's "the only check that the
 * extraction actually works" get ticked without anything being checked.
 */
if (gate.kind === 'fail') {
  const { message } = gate;
  describe('live eval requested but not runnable', () => {
    it('refuses to pass without ANTHROPIC_API_KEY', () => {
      throw new Error(message);
    });
  });
}

const CANONICAL =
  '18k in the bank, 9.5k a month burn, 12 customers paying 400, about 8% churn, 2 new customers a month';

describe.skipIf(!LIVE)('smoke test: the paid path actually works', () => {
  it(
    'turns the canonical sentence into six grounded numbers',
    async () => {
      const out = await extractFromSentence(CANONICAL);
      expect(out.ok).toBe(true);
      if (!out.ok) return;

      // Every field grounded, nothing refused, nothing guessed.
      expect(out.result.missing).toEqual([]);
      for (const key of PARAM_KEYS) expect(out.result[key]).not.toBeNull();

      expect(out.result.startingCash).toBe(18000);
      expect(out.result.monthlyBurn).toBe(9500);
      expect(out.result.customers).toBe(12);
      expect(out.result.price).toBe(400);
      expect(out.result.churn).toBeCloseTo(0.08, 4);
      expect(out.result.newPerMonth).toBe(2);

      // Assumptions are the product's argument surface, so an empty list is a failure.
      expect(out.result.assumptions.length).toBeGreaterThanOrEqual(2);
    },
    60_000,
  );
});

describe.skipIf(!LIVE)('adversarial extraction', () => {
  for (const testCase of PARSE_CASES) {
    it(
      `${testCase.id} — ${testCase.probes}`,
      async () => {
        const out = await extractFromSentence(testCase.sentence);
        const graded = gradeCase(testCase, out.ok ? out.result : null);
        // Report every violation at once rather than stopping at the first.
        expect(graded.failures.join('\n')).toBe('');
      },
      60_000,
    );
  }
});
