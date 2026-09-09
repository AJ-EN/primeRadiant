import { describe, it, expect } from 'vitest';
import { shareCard } from './share';
import type { Params } from './engine';

/** The spec example: viable at steady state, dead in month 6. */
const SPEC: Params = {
  startingCash: 18000,
  monthlyBurn: 9500,
  customers: 12,
  price: 400,
  churn: 0.08,
  newPerMonth: 2,
};

describe('shareCard', () => {
  it('leads with the verdict, which is the claim worth clicking', () => {
    expect(shareCard(SPEC).headline).toBe('You die before you get there.');
  });

  it('carries the closed-form facts a founder cannot compute in their head', () => {
    const card = shareCard(SPEC);
    expect(card.facts[0]).toBe('Cash gone in month 6');
    expect(card.facts[1]).toBe('Breaks even in month 29');
    expect(card.facts[2]).toBe('Ceiling $10,000/mo against $9,500 burn');
    expect(card.description).toBe(card.facts.join(' · '));
  });

  it('says so plainly when the model survives', () => {
    const card = shareCard({ ...SPEC, startingCash: 250000 });
    expect(card.headline).toBe('You never run out.');
    expect(card.facts[0]).toBe('Still solvent at month 24');
    expect(card.tone).toBe('good');
  });

  it('handles a ceiling that never covers burn', () => {
    expect(shareCard({ ...SPEC, churn: 0.25 }).facts[1]).toBe('Never breaks even');
  });

  it('renders an infinite ceiling without producing NaN', () => {
    const card = shareCard({ ...SPEC, churn: 0 });
    expect(card.description).not.toContain('NaN');
    expect(card.facts[2]).toContain('∞');
  });

  /**
   * The security property, asserted rather than assumed. shareCard takes Params, so there is
   * no argument through which a sentence or an assumption string could reach a preview card.
   * If someone widens the signature to ModelState later, this test is the tripwire.
   */
  it('emits nothing but numbers we formatted and text we wrote', () => {
    const card = shareCard(SPEC);
    const everything = [card.headline, card.description, ...card.facts].join(' ');
    for (const hostile of [
      'Verified by Prime Radiant',
      'http://evil.example',
      '<script>',
      'Send your seed round to',
    ]) {
      expect(everything).not.toContain(hostile);
    }
    // Every fact is one of our templates with numbers substituted in.
    expect(everything).toMatch(/^[\w\s$,./%·∞:'-]+$/);
  });
});
