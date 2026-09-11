import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { classifyError, MAX_RETRIES, REQUEST_TIMEOUT_MS } from './extract';

/**
 * Instances without running constructors: `instanceof` only needs the prototype chain, and
 * the SDK's error constructors take shapes that would make these tests about the SDK rather
 * than about our mapping.
 */
function sdkError<T>(Ctor: new (...args: never[]) => T, props: Record<string, unknown> = {}): T {
  return Object.assign(Object.create(Ctor.prototype), props) as T;
}

describe('classifyError', () => {
  it('names a timeout as a timeout, not a generic connection failure', () => {
    // Ordering matters: APIConnectionTimeoutError extends APIConnectionError, so a broader
    // branch placed first would swallow this and blame the network.
    const out = classifyError(sdkError(Anthropic.APIConnectionTimeoutError));
    expect(out.reason).toBe('timeout');
  });

  it('names an unreachable upstream', () => {
    expect(classifyError(sdkError(Anthropic.APIConnectionError)).reason).toBe('unavailable');
  });

  it('passes a 429 through as rate limiting rather than a parse failure', () => {
    expect(classifyError(sdkError(Anthropic.RateLimitError)).reason).toBe('rate_limited');
  });

  it('separates a rejected key from a missing one, because the fix differs', () => {
    expect(classifyError(sdkError(Anthropic.AuthenticationError)).reason).toBe('key_rejected');
    expect(classifyError(sdkError(Anthropic.PermissionDeniedError)).reason).toBe('key_rejected');
  });

  it('treats 5xx as theirs and 4xx as ours', () => {
    const server = classifyError(sdkError(Anthropic.APIError, { status: 503, name: 'APIError' }));
    expect(server.reason).toBe('unavailable');
    expect(server.detail).toContain('503');

    const ours = classifyError(sdkError(Anthropic.APIError, { status: 400, name: 'APIError' }));
    expect(ours.reason).toBe('parse_failed');
  });

  it('falls back without throwing on anything it does not recognise', () => {
    for (const thrown of [new Error('boom'), 'a string', null, undefined, { weird: true }]) {
      const out = classifyError(thrown);
      expect(out.reason).toBe('parse_failed');
      expect(typeof out.detail).toBe('string');
    }
  });

  it('never leaks an unbounded message into a log line', () => {
    const out = classifyError(new Error('x'.repeat(5000)));
    expect(out.detail.length).toBeLessThan(120);
  });

  /**
   * The SDK version in use does not export APIStatusError. Relying on it would have made
   * `instanceof undefined` throw a TypeError from inside the catch block, turning every
   * upstream error into a crash. This is the tripwire if someone reintroduces it.
   */
  it('only reaches for error classes this SDK actually exports', () => {
    for (const name of [
      'APIConnectionTimeoutError',
      'APIConnectionError',
      'RateLimitError',
      'AuthenticationError',
      'PermissionDeniedError',
      'APIError',
    ] as const) {
      expect(typeof Anthropic[name]).toBe('function');
    }
  });
});

describe('timeout budget', () => {
  it('leaves the server enough room to name the failure before the client gives up', () => {
    // Retries multiply wall clock: timeout x (retries + 1), plus backoff.
    const serverWorstCase = REQUEST_TIMEOUT_MS * (MAX_RETRIES + 1);
    const clientAbort = 30_000;
    expect(serverWorstCase).toBeLessThan(clientAbort);
  });

  it('is far below the ten-minute SDK default it replaced', () => {
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });
});
