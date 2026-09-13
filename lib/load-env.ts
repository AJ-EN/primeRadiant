/**
 * A minimal `.env` reader, hand-rolled on purpose.
 *
 * vitest does not load `.env` files into `process.env`, and neither of the obvious helpers is
 * importable here: `loadEnv` is not exported by `vitest/config` in this version, `vite` is a
 * transitive dependency that pnpm's strict layout does not expose, and `dotenv` is not
 * installed. Adding a dependency to read `KEY=value` lines would be a poor trade in a project
 * whose stated value is that it is small, so this parses them directly.
 *
 * The parsing and precedence rules are pure and pinned in `load-env.test.ts`, because a
 * hand-rolled parser that nothing tests is how you end up with a key that silently reads as
 * `sk-ant-xxx # my key`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Highest precedence first — the first file to define a key wins, and `applyEnv` never
 * overwrites. `.env.local` beating `.env` is the Next.js and Vite convention.
 */
export const ENV_FILES = ['.env.local', '.env'] as const;

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    // `export FOO=bar` is common in files people also source from a shell.
    const body = line.startsWith('export ') ? line.slice(7).trim() : line;

    // Split on the FIRST `=` only, so values may contain `=`.
    const eq = body.indexOf('=');
    if (eq <= 0) continue;

    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    const rest = body.slice(eq + 1);
    const trimmed = rest.trim();
    const quote = trimmed[0];

    if ((quote === '"' || quote === "'") && trimmed.length >= 2 && trimmed.endsWith(quote)) {
      // Quoted: keep everything inside, including `=` and `#`.
      out[key] = trimmed.slice(1, -1);
    } else {
      // Unquoted: an inline comment starts at whitespace followed by `#`. A `#` with no space
      // before it is part of the value, which is how dotenv treats it too.
      const comment = rest.search(/\s#/);
      out[key] = (comment === -1 ? rest : rest.slice(0, comment)).trim();
    }
  }

  return out;
}

/**
 * Copies `parsed` into `env`, never overwriting. Returns only what it actually set.
 *
 * Not overwriting is the whole contract: the shell must win, so
 * `ANTHROPIC_API_KEY=... pnpm eval:parse` overrides whatever sits on disk.
 */
export function applyEnv(
  parsed: Record<string, string>,
  env: Record<string, string | undefined>,
): Record<string, string> {
  const applied: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) {
      env[key] = value;
      applied[key] = value;
    }
  }
  return applied;
}

/** Thin fs glue over the two pure functions above. Absent files are normal, not an error. */
export function loadEnvFiles(
  dir: string,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const applied: Record<string, string> = {};

  for (const file of ENV_FILES) {
    let text: string;
    try {
      text = readFileSync(join(dir, file), 'utf8');
    } catch {
      continue;
    }
    Object.assign(applied, applyEnv(parseEnvFile(text), env));
  }

  return applied;
}
