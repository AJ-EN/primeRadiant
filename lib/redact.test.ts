import { describe, it, expect } from 'vitest';
import { redactPayload, redactProperties, isUrlLikeKey } from './redact';

/** A real payload: sentence plus actual cash position, reversible by anyone. */
const PAYLOAD =
  'eyJ2IjoxLCJzIjoiMThrIGluIHRoZSBiYW5rIiwicCI6eyJzdGFydGluZ0Nhc2giOjE4MDAwfX0';

describe('redactPayload', () => {
  it('removes the model payload but keeps the rest of the URL usable', () => {
    const out = redactPayload(`https://example.com/m?d=${PAYLOAD}&utm_source=x`) as string;
    expect(out).not.toContain(PAYLOAD);
    expect(out).toContain('d=redacted');
    expect(out).toContain('utm_source=x');
    expect(out).toContain('/m');
  });

  it('leaves URLs without a payload untouched', () => {
    const url = 'https://example.com/?utm_source=x';
    expect(redactPayload(url)).toBe(url);
  });

  it('never throws on values an analytics hook might hand it', () => {
    for (const v of [undefined, null, 42, {}, [], '', 'not a url', 'javascript:alert(1)']) {
      expect(() => redactPayload(v)).not.toThrow();
    }
    expect(redactPayload(42)).toBe(42);
    expect(redactPayload('not a url')).toBe('not a url');
  });
});

describe('isUrlLikeKey', () => {
  it('matches the properties that actually carry URLs', () => {
    for (const k of ['$current_url', '$referrer', '$referring_domain', '$initial_current_url'])
      expect(isUrlLikeKey(k)).toBe(true);
    for (const k of ['$browser', '$os', 'from_link', 'changed']) expect(isUrlLikeKey(k)).toBe(false);
  });
});

describe('redactProperties', () => {
  it('scrubs every URL-ish property and leaves the rest alone', () => {
    const out = redactProperties({
      $current_url: `https://example.com/m?d=${PAYLOAD}`,
      $referrer: `https://example.com/m?d=${PAYLOAD}`,
      $browser: 'Chrome',
      from_link: true,
    });
    expect(JSON.stringify(out)).not.toContain(PAYLOAD);
    expect(out.$browser).toBe('Chrome');
    expect(out.from_link).toBe(true);
  });

  it('does not mutate the object it was given', () => {
    const props = { $current_url: `https://example.com/m?d=${PAYLOAD}` };
    redactProperties(props);
    expect(props.$current_url).toContain(PAYLOAD);
  });
});
