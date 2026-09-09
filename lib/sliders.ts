import type { Params } from './engine';
import { money, percent } from './format';

/**
 * The five sliders. `customers` is deliberately not one of them (SPEC 2 says five): how many
 * customers you have today is a fact about your business, not a lever you argue about. It is
 * still editable, as a number field, because a fork has to be able to disagree with it.
 */
export type SliderKey = Exclude<keyof Params, 'customers'>;

export type SliderSpec = {
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
  /**
   * Position-to-value exponent. 1 is linear. Above 1 gives more resolution at the low end,
   * which is where every pre-seed company actually lives — with a linear $0-500k track, the
   * entire $5k-50k range is the first 10% of the slider.
   */
  gamma: number;
  format: (v: number) => string;
  /** Plain-English claim this parameter makes, for the assumptions block. */
  claim: (v: number) => string;
};

/**
 * Fixed domains, not relative to the parsed value (SPEC 7.1), so URLs stay stable and
 * comparisons across forks are meaningful.
 */
export const SLIDERS: SliderSpec[] = [
  {
    key: 'startingCash',
    label: 'Starting cash',
    min: 0,
    max: 500_000,
    step: 500,
    gamma: 2.2,
    format: money,
    claim: (v) => `You have ${money(v)} in the bank today, and nothing else is coming in.`,
  },
  {
    key: 'monthlyBurn',
    label: 'Monthly burn',
    min: 0,
    max: 200_000,
    step: 250,
    gamma: 2.2,
    format: money,
    claim: (v) =>
      `Burn stays flat at ${money(v)} a month. It does not rise as the customer count grows.`,
  },
  {
    key: 'price',
    label: 'Price per customer',
    min: 0,
    max: 5_000,
    step: 10,
    gamma: 1,
    format: money,
    claim: (v) =>
      `Every customer pays ${money(v)} a month, forever. No price changes, no second revenue line.`,
  },
  {
    key: 'churn',
    label: 'Monthly churn',
    min: 0,
    max: 0.25,
    step: 0.001,
    gamma: 1,
    format: (v) => `${(v * 100).toFixed(1)}%`,
    claim: (v) =>
      `${percent(v)} of your customers leave every month, applied to the base you already had before the month's new signups land.`,
  },
  {
    key: 'newPerMonth',
    label: 'New customers / month',
    min: 0,
    max: 100,
    step: 1,
    gamma: 1,
    format: (v) => String(v),
    claim: (v) =>
      `${v} new customers arrive every month as a flat count, not as a growth rate that compounds.`,
  },
];

/** Integer track the range input actually rides on. Value is derived from it. */
export const POS_STEPS = 1000;

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

export function valueToPos(value: number, s: SliderSpec): number {
  const span = s.max - s.min;
  if (span <= 0) return 0;
  const t = clamp((value - s.min) / span, 0, 1);
  return Math.round(Math.pow(t, 1 / s.gamma) * POS_STEPS);
}

export function posToValue(pos: number, s: SliderSpec): number {
  const t = Math.pow(clamp(pos, 0, POS_STEPS) / POS_STEPS, s.gamma);
  const raw = s.min + t * (s.max - s.min);
  const snapped = Math.round(raw / s.step) * s.step;
  // Floating point: 0.001 steps on churn otherwise produce 0.07200000000000001.
  const dp = Math.max(0, -Math.floor(Math.log10(s.step)));
  return clamp(Number(snapped.toFixed(dp)), s.min, s.max);
}

/**
 * SPEC 7.1: a parsed value above a slider's max expands that slider's domain to 2x the value
 * for the session, rather than clamping the input. Clamping would silently rewrite the user's
 * own number, which is the one thing this product is not allowed to do.
 */
export function resolveSliders(p: Params): SliderSpec[] {
  return SLIDERS.map((s) => {
    const v = p[s.key];
    if (v <= s.max) return s;
    const max = Math.ceil((v * 2) / s.step) * s.step;
    return { ...s, max };
  });
}
