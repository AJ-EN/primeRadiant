import { describe, it, expect } from 'vitest';
import { parseEnvFile, applyEnv } from './load-env';

/**
 * This parser exists only because no dependency here could read a `.env` file (see load-env.ts).
 * Hand-rolled parsing that nothing tests is its own defect, so the rules are pinned here.
 */
describe('parseEnvFile', () => {
  it('reads plain KEY=value', () => {
    expect(parseEnvFile('ANTHROPIC_API_KEY=sk-ant-abc')).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-abc',
    });
  });

  it('ignores blank lines and full-line comments', () => {
    const text = ['# a comment', '', '   ', 'A=1', '   # indented comment', 'B=2'].join('\n');
    expect(parseEnvFile(text)).toEqual({ A: '1', B: '2' });
  });

  it('accepts an `export` prefix', () => {
    expect(parseEnvFile('export A=1')).toEqual({ A: '1' });
  });

  it('splits on the first = only, so values may contain =', () => {
    expect(parseEnvFile('TOKEN=abc=def==')).toEqual({ TOKEN: 'abc=def==' });
  });

  it('strips one pair of surrounding quotes, keeping # and = inside', () => {
    expect(parseEnvFile('A="x = y # z"')).toEqual({ A: 'x = y # z' });
    expect(parseEnvFile("B='x = y # z'")).toEqual({ B: 'x = y # z' });
  });

  it('strips an inline comment only when whitespace precedes the #', () => {
    expect(parseEnvFile('A=sk-ant-abc # my key')).toEqual({ A: 'sk-ant-abc' });
    // No space before '#': part of the value. Losing half a key to a greedy comment rule
    // would surface as a confusing 401, not as a parse error.
    expect(parseEnvFile('B=sk-ant#abc')).toEqual({ B: 'sk-ant#abc' });
  });

  it('handles CRLF line endings', () => {
    expect(parseEnvFile('A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' });
  });

  it('skips lines that are not definitions', () => {
    expect(parseEnvFile(['just text', '=novalue', 'A=1'].join('\n'))).toEqual({ A: '1' });
  });

  it('skips keys that are not valid shell identifiers', () => {
    expect(parseEnvFile(['1BAD=x', 'ok_KEY2=y', 'has-dash=z'].join('\n'))).toEqual({
      ok_KEY2: 'y',
    });
  });

  it('keeps an explicitly empty value empty', () => {
    // evalGate treats blank as absent; that decision belongs there, not here.
    expect(parseEnvFile('ANTHROPIC_API_KEY=')).toEqual({ ANTHROPIC_API_KEY: '' });
  });
});

describe('applyEnv', () => {
  it('sets keys the environment does not already have', () => {
    const env: Record<string, string | undefined> = {};
    expect(applyEnv({ A: '1' }, env)).toEqual({ A: '1' });
    expect(env.A).toBe('1');
  });

  it('never overwrites, so the shell beats the file', () => {
    const env: Record<string, string | undefined> = { A: 'from-the-shell' };
    const applied = applyEnv({ A: 'from-the-file' }, env);

    expect(env.A).toBe('from-the-shell');
    expect(applied).toEqual({});
  });

  it('treats an existing empty string as set, not as absent', () => {
    const env: Record<string, string | undefined> = { A: '' };
    applyEnv({ A: 'from-the-file' }, env);
    expect(env.A).toBe('');
  });
});
