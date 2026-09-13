import { describe, it, expect } from 'vitest';
import { evalGate, MISSING_KEY_MESSAGE } from './eval-gate';

/**
 * Pins the behaviour that made `pnpm eval:parse` untrustworthy: an explicitly requested live
 * eval that cannot run must fail, never skip. Offline, so it runs inside `pnpm test` and the
 * regression cannot come back quietly.
 */
describe('evalGate', () => {
  it('skips when the eval was not requested, even with a key present', () => {
    expect(evalGate({ ANTHROPIC_API_KEY: 'sk-ant-real' })).toEqual({ kind: 'skip' });
    expect(evalGate({ RUN_LIVE_EVAL: '0', ANTHROPIC_API_KEY: 'sk-ant-real' })).toEqual({
      kind: 'skip',
    });
  });

  it('runs when requested with a key', () => {
    expect(evalGate({ RUN_LIVE_EVAL: '1', ANTHROPIC_API_KEY: 'sk-ant-real' })).toEqual({
      kind: 'run',
    });
  });

  it('fails, rather than skipping, when requested without a key', () => {
    expect(evalGate({ RUN_LIVE_EVAL: '1' }).kind).toBe('fail');
  });

  it('treats a blank or whitespace-only key as absent', () => {
    expect(evalGate({ RUN_LIVE_EVAL: '1', ANTHROPIC_API_KEY: '' }).kind).toBe('fail');
    expect(evalGate({ RUN_LIVE_EVAL: '1', ANTHROPIC_API_KEY: '   ' }).kind).toBe('fail');
  });

  it('names .env.local and the variable in the failure, because that is the fix', () => {
    expect(MISSING_KEY_MESSAGE).toContain('.env.local');
    expect(MISSING_KEY_MESSAGE).toContain('ANTHROPIC_API_KEY');
  });

  it('never returns skip once the eval has been explicitly requested', () => {
    // The whole defect in one assertion. RUN_LIVE_EVAL=1 must never produce a silent pass,
    // whatever the key looks like.
    for (const key of [undefined, '', '   ', 'sk-ant-real']) {
      expect(evalGate({ RUN_LIVE_EVAL: '1', ANTHROPIC_API_KEY: key }).kind).not.toBe('skip');
    }
  });
});
