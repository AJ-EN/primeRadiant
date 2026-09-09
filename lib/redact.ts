/**
 * Pure, no imports, testable in isolation — same reasoning as lib/engine.ts.
 *
 * The `?d=` payload is the founder's sentence and their actual cash position, base64url
 * encoded, which is reversible by anyone. Analytics SDKs attach the full URL to autocaptured
 * properties, so without this the product's "no accounts, no database, nothing is stored"
 * position is false in the way that matters: the numbers land in a third party.
 */

/** The query parameter carrying the whole model. */
export const PAYLOAD_PARAM = 'd';

const REDACTED = 'redacted';

/**
 * Strip the model payload out of a URL, leaving the rest intact so path and campaign
 * analysis still work. Returns non-strings and unparseable strings untouched, because a
 * sanitiser that throws inside an analytics hook takes the whole page down with it.
 */
export function redactPayload(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    if (!url.searchParams.has(PAYLOAD_PARAM)) return value;
    url.searchParams.set(PAYLOAD_PARAM, REDACTED);
    return url.toString();
  } catch {
    return value;
  }
}

/** Property names whose values are URLs worth scrubbing. */
export function isUrlLikeKey(key: string): boolean {
  return /url|referr/i.test(key);
}

/** Scrub every URL-ish property of an analytics event. */
export function redactProperties(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...props };
  for (const key of Object.keys(out)) {
    if (isUrlLikeKey(key)) out[key] = redactPayload(out[key]);
  }
  return out;
}
