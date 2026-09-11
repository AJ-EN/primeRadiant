import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  ExtractionSchema,
  MAX_TOKENS,
  MODEL,
  SYSTEM,
  interpretExtraction,
  salvageJson,
  type ParseFailure,
  type ParseResult,
} from './parse';

/**
 * How long we are willing to make somebody watch a "Reading…" button.
 *
 * The SDK default is ten minutes, which is not a timeout so much as an absence of one: a hung
 * upstream would have held the function open, billed for the wait, and left the composer
 * disabled with no way out. Haiku extraction lands in one to two seconds, so ten is generous.
 *
 * Retries multiply wall clock — the ceiling is timeout x (maxRetries + 1) plus backoff — so
 * one retry keeps the worst case near 21s, comfortably inside the client's own 30s abort.
 * Change one of these three numbers and check the other two.
 */
export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_RETRIES = 1;

export type ExtractResult =
  | { ok: true; result: ParseResult; detail: string }
  | { ok: false; reason: ParseFailure; detail: string };

/**
 * Name the failure. Pure, exported and tested, because the whole point of a taxonomy is that
 * it is checkable — and because a chain of `instanceof` written once and never exercised is
 * just a longer way of writing `catch`.
 *
 * Most specific first: a timeout is a connection error, and every 4xx and 5xx is an
 * APIStatusError, so ordering carries the meaning here.
 */
export function classifyError(err: unknown): { reason: ParseFailure; detail: string } {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return { reason: 'timeout', detail: 'APIConnectionTimeoutError' };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { reason: 'unavailable', detail: 'APIConnectionError' };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { reason: 'rate_limited', detail: 'RateLimitError 429' };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return { reason: 'key_rejected', detail: 'AuthenticationError 401' };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return { reason: 'key_rejected', detail: 'PermissionDeniedError 403' };
  }
  // The base class, not APIStatusError: this SDK version does not export the latter, and
  // `instanceof undefined` throws a TypeError from inside the catch block, which would have
  // turned every upstream error into a crash.
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    // 5xx is theirs and will pass; 4xx is ours and means a bug in this request.
    return {
      reason: status >= 500 ? 'unavailable' : 'parse_failed',
      detail: `${err.name} ${status}`,
    };
  }
  return {
    reason: 'parse_failed',
    detail: err instanceof Error ? `${err.name}: ${err.message.slice(0, 80)}` : 'unknown',
  };
}

/**
 * The one call that costs money.
 *
 * Lives here rather than in the route so the eval suite exercises the exact production path
 * instead of a copy of it. A smoke test against a reimplementation proves nothing.
 *
 * Never throws: every outcome comes back named, so the caller logs one line and the reader
 * gets one true sentence.
 */
export async function extractFromSentence(sentence: string): Promise<ExtractResult> {
  const client = new Anthropic({
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  });

  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: 'user', content: sentence }],
      output_config: { format: zodOutputFormat(ExtractionSchema) },
    });

    // A reply cut off at max_tokens is half a JSON object. It used to surface as a generic
    // parse failure, which pointed at the prompt when the fix is the token cap.
    if (response.stop_reason === 'max_tokens') {
      return { ok: false, reason: 'truncated', detail: `max_tokens ${MAX_TOKENS}` };
    }

    let raw: unknown = response.parsed_output;
    if (!raw) {
      // Structured output should always populate parsed_output. If it did not, try the raw
      // text before giving up.
      const text = response.content.find((b) => b.type === 'text');
      raw = text ? salvageJson(text.text) : null;
    }

    const interpreted = interpretExtraction(raw);
    return interpreted.ok
      ? { ok: true, result: interpreted.result, detail: response.stop_reason ?? 'end_turn' }
      : { ok: false, reason: interpreted.reason, detail: 'schema' };
  } catch (err) {
    return { ok: false, ...classifyError(err) };
  }
}
