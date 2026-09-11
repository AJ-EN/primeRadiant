import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The design tokens are the source of truth for colour, and they live in CSS rather than
 * TypeScript, so this test reads them from disk. Without it the contrast fix is a one-time
 * correction that the next palette tweak silently undoes — which is exactly how ink-3 spent
 * its whole life at 2.30:1 across 27 uses of real text.
 */
const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

function token(name: string): string {
  const match = CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token --${name} not found in globals.css`);
  return match[1];
}

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every surface text can land on. `sunk` is the darkest, so it is always the binding one. */
const BACKGROUNDS = ['paper', 'surface', 'surface-sunk'] as const;

describe('text tones meet WCAG AA on every background they can appear on', () => {
  for (const tone of ['ink', 'ink-2', 'ink-3'] as const) {
    it(`--${tone} clears 4.5:1 everywhere`, () => {
      for (const bg of BACKGROUNDS) {
        const ratio = contrast(token(tone), token(bg));
        expect(ratio, `--${tone} on --${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('keeps the three tones visibly distinct, not merely compliant', () => {
    // Fixing ink-3 alone would have pushed it onto ink-2 and flattened the hierarchy.
    const ink = contrast(token('ink'), token('paper'));
    const ink2 = contrast(token('ink-2'), token('paper'));
    const ink3 = contrast(token('ink-3'), token('paper'));
    expect(ink).toBeGreaterThan(ink2 * 1.5);
    expect(ink2).toBeGreaterThan(ink3 * 1.25);
  });

  it('holds the accent and danger tones to the same bar, since both carry text', () => {
    for (const tone of ['accent', 'danger'] as const) {
      for (const bg of BACKGROUNDS) {
        const ratio = contrast(token(tone), token(bg));
        expect(ratio, `--${tone} on --${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('exempts --ink-faint, which is decoration and disabled states only', () => {
    // Documented as failing on purpose. If this ever passes, someone widened its use.
    expect(contrast(token('ink-faint'), token('surface-sunk'))).toBeLessThan(4.5);
  });
});
