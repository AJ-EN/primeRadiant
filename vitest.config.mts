import { defineConfig } from 'vitest/config';
import { loadEnvFiles } from './lib/load-env';

/**
 * This file exists to stop `pnpm eval:parse` reporting a false green.
 *
 * vitest does not load `.env` files into `process.env`. The live eval reads
 * `process.env.ANTHROPIC_API_KEY` directly, so a key sitting in `.env.local` — the obvious
 * place for it, and the one `.gitignore` is set up for — was invisible, and all 13 adversarial
 * cases skipped while the command exited 0. See `lib/eval-gate.ts`.
 *
 * Loading env files does not make any test reach the network: `pnpm test` stays offline
 * because `RUN_LIVE_EVAL` gates the live file, not the presence of a key.
 */

// Applied to this process for anything reading env at config time, and returned so the same
// values can be handed to the test workers explicitly below.
const fromFiles = loadEnvFiles(process.cwd());

export default defineConfig({
  test: {
    // Passed through rather than relying on workers inheriting a mutated process.env, which
    // varies by pool. `loadEnvFiles` already dropped anything the shell had set, so this
    // cannot clobber `ANTHROPIC_API_KEY=... pnpm eval:parse`.
    env: fromFiles,
  },
});
