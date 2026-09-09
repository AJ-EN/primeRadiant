import { DEFAULT_MONTHS, model, type Params } from './engine';
import { money } from './format';
import { headline, tone } from './verdict';

export type ShareCard = {
  /** The verdict. This is the claim worth clicking, so it leads. */
  headline: string;
  /** Closed-form facts, shortened for a preview card. */
  facts: string[];
  /** `facts` joined, for og:description. */
  description: string;
  tone: 'good' | 'bad';
};

/**
 * Everything a link preview is allowed to say.
 *
 * It takes `Params` and never `ModelState`, deliberately. `?d=` is written by whoever made
 * the link: 400 characters of sentence plus eight assumption strings, roughly 2.6KB of
 * arbitrary prose. Today that only renders after a click. In a preview card it would render
 * inside X, Slack and iMessage with our domain attached as the source, so anyone could
 * publish a card saying anything under our name.
 *
 * Passing only the six numbers makes that impossible to get wrong later: this function
 * cannot leak text it was never given. The numbers themselves are still chosen by the link's
 * author, so a crafted link can show an absurd model, but an absurd model is the product
 * working. Arbitrary prose under our domain is not.
 */
export function shareCard(params: Params, months = DEFAULT_MONTHS): ShareCard {
  const { derived } = model(params, months);

  const facts = [
    derived.runoutMonth !== null
      ? `Cash gone in month ${derived.runoutMonth}`
      : `Still solvent at month ${months}`,
    derived.breakevenMonth !== null
      ? `Breaks even in month ${derived.breakevenMonth}`
      : 'Never breaks even',
    `Ceiling ${money(derived.ceilingRevenue)}/mo against ${money(params.monthlyBurn)} burn`,
  ];

  return {
    headline: headline(derived, months),
    facts,
    description: facts.join(' · '),
    tone: tone(derived),
  };
}
