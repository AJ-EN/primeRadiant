import { z } from 'zod';
import { PARAM_KEYS, validateParams, type ParamKey } from './engine';

// The engine owns the key list and the bounds because it has no imports and is the thing
// those bounds are actually about. Re-exported so callers have one place to reach for.
export { PARAM_KEYS };
export type { ParamKey };

/** Zod 4's z.number() already rejects NaN and Infinity, so min(0) is the whole guard. */
const money = z.number().min(0);
const rate = z.number().min(0).max(1);

/**
 * Shape here, bounds in the engine. `superRefine` delegates to `validateParams` rather than
 * restating min/max, so a bound cannot drift between what the URL accepts and what the form
 * accepts. A payload outside the bounds is rejected, never quietly repaired.
 */
export const ParamsSchema = z
  .object({
    startingCash: z.number(),
    monthlyBurn: z.number(),
    customers: z.number(),
    price: z.number(),
    churn: z.number(),
    newPerMonth: z.number(),
  })
  .superRefine((value, ctx) => {
    const result = validateParams(value);
    if (result.ok) return;
    for (const issue of result.issues) {
      ctx.addIssue({ code: 'custom', path: [issue.key], message: issue.message });
    }
  });

/**
 * What /api/parse returns.
 *
 * The six numbers are NULLABLE on purpose. A field the sentence did not ground comes back
 * as null and is listed in `missing`. It is never a guess. See SPEC 4.2 — this is the rule
 * the credibility of the whole product rests on.
 */
export const ParseResultSchema = z.object({
  startingCash: money.nullable(),
  monthlyBurn: money.nullable(),
  customers: money.nullable(),
  price: money.nullable(),
  churn: rate.nullable(),
  newPerMonth: money.nullable(),
  currency: z.string().max(8).default('USD'),
  missing: z.array(z.enum(PARAM_KEYS)).default([]),
  /** Defensible defaults, not extractions. Flagged visually so they can be argued with. */
  inferred: z.array(z.enum(PARAM_KEYS)).default([]),
  assumptions: z.array(z.string().min(1).max(400)).max(10).default([]),
});

export type ParseResult = z.infer<typeof ParseResultSchema>;

/**
 * The model is a parser, not an oracle, and parsers drift. Rather than rejecting a response
 * whose `missing` list disagrees with its own nulls, reconcile it: nulls are the source of
 * truth, because a null is the one thing that cannot be a fabricated number.
 */
/** Our own generated prose, trimmed at a word boundary to fit the wire budget. */
function fitAssumption(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= ASSUMPTION_MAX) return trimmed;
  const cut = trimmed.slice(0, ASSUMPTION_MAX - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > ASSUMPTION_MAX * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

export function normalizeParseResult(r: ParseResult): ParseResult {
  const missing = PARAM_KEYS.filter((k) => r[k] === null);
  return {
    ...r,
    // Bounded here, not rejected: a parser that returns one sentence too many is a nuisance,
    // not a failure, and dropping the whole parse would send the reader to manual entry.
    assumptions: r.assumptions.slice(0, ASSUMPTION_COUNT_MAX).map(fitAssumption),
    missing,
    // A field cannot be both absent and inferred.
    inferred: r.inferred.filter((k) => !missing.includes(k)),
    currency: 'USD',
  };
}

/* ---------------------------------------------------------------------------
   The v1 wire contract. See docs/URL-CONTRACT.md before changing anything here:
   once a link is public these numbers are frozen, because every URL in the wild
   has to keep decoding and there is no database to migrate them with.
   --------------------------------------------------------------------------- */

export const SCHEMA_VERSION = 1;

/**
 * Maximum encoded payload, in base64url characters.
 *
 * SPEC 5.1 named ~1500 as the point to switch to a short-code service. That figure was
 * chosen so a link stayed tweet-length, which t.co made irrelevant. The real constraint is
 * the ~2000-character line below which every proxy, mail client and chat app is safe, so the
 * budget is 1800: it leaves room for the `/api/og?d=` prefix that wraps the same payload
 * again, and it buys a sentence long enough to actually describe a business.
 *
 * The caps below are derived from this number, worst case, with every optional field
 * present and twelve-digit values in all six slots. `lib/url.test.ts` proves it.
 */
export const PAYLOAD_BUDGET = 1800;

export const SENTENCE_MAX = 200;
export const ASSUMPTION_MAX = 140;
export const ASSUMPTION_COUNT_MAX = 5;

/** The URL is the database. This is its schema. */
export const ModelStateSchema = z.object({
  /** Schema version, for future migrations. Bump only with a decoder for the old shape. */
  v: z.literal(SCHEMA_VERSION),
  /** The original sentence, for the echo strip. */
  s: z.string().max(SENTENCE_MAX).default(''),
  p: ParamsSchema,
  /** Assumption sentences, in plain English, as returned by the parser. */
  a: z.array(z.string().max(ASSUMPTION_MAX)).max(ASSUMPTION_COUNT_MAX).default([]),
  /**
   * Param keys that were defaulted rather than read: either the parser filled a defensible
   * default, or the reader told the clarifier they did not know. This is what renders the
   * "we guessed this" badge, so it has to survive the URL or the badge is decorative.
   * Omitted when empty to keep the payload short.
   */
  i: z.array(z.enum(PARAM_KEYS)).max(6).optional(),
  /**
   * Origin params, present only on a fork. Carries the parent's numbers so the fork can
   * draw the original curve as a grey dashed ghost and diff changed vs unchanged params
   * (SPEC 6.3) with no database behind it.
   */
  o: ParamsSchema.optional(),
  /** Short fingerprint of the origin model. Groups a family of forks in analytics. */
  f: z.string().max(16).optional(),
});

export type ModelState = z.infer<typeof ModelStateSchema>;
