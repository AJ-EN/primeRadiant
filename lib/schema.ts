import { z } from 'zod';
import type { Params } from './engine';

export const PARAM_KEYS = [
  'startingCash',
  'monthlyBurn',
  'customers',
  'price',
  'churn',
  'newPerMonth',
] as const;

export type ParamKey = (typeof PARAM_KEYS)[number];

/** Zod 4's z.number() already rejects NaN and Infinity, so min(0) is the whole guard. */
const money = z.number().min(0);
const rate = z.number().min(0).max(1);

export const ParamsSchema = z.object({
  startingCash: money,
  monthlyBurn: money,
  customers: money,
  price: money,
  churn: rate,
  newPerMonth: money,
}) satisfies z.ZodType<Params>;

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
  assumptions: z.array(z.string().min(1).max(280)).max(8).default([]),
});

export type ParseResult = z.infer<typeof ParseResultSchema>;

/**
 * The model is a parser, not an oracle, and parsers drift. Rather than rejecting a response
 * whose `missing` list disagrees with its own nulls, reconcile it: nulls are the source of
 * truth, because a null is the one thing that cannot be a fabricated number.
 */
export function normalizeParseResult(r: ParseResult): ParseResult {
  const missing = PARAM_KEYS.filter((k) => r[k] === null);
  return {
    ...r,
    missing,
    // A field cannot be both absent and inferred.
    inferred: r.inferred.filter((k) => !missing.includes(k)),
    currency: 'USD',
  };
}

/** The URL is the database. This is its schema. */
export const ModelStateSchema = z.object({
  /** Schema version, for future migrations. Bump only with a decoder for the old shape. */
  v: z.literal(1),
  /** The original sentence, for the echo strip. */
  s: z.string().max(400).default(''),
  p: ParamsSchema,
  /** Assumption sentences, in plain English, as returned by the parser. */
  a: z.array(z.string().max(280)).max(8).default([]),
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
