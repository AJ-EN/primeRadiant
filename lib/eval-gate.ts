/**
 * Whether the live extraction eval may run, as a pure decision.
 *
 * This is its own module for one reason. `pnpm eval:parse` used to exit 0 with all 13 cases
 * skipped whenever the key was not visible to the process — which was always, because vitest
 * does not load `.env.local` into `process.env` and `.env.local` is the obvious place to put
 * a key (it is the one `.gitignore` is set up for). `docs/DEPLOY.md` records that command as
 * "the only check that the extraction actually works", so the silent skip ticked the single
 * gate protecting the never-exercised parse path.
 *
 * **A gate that cannot run must fail, not pass.** Pure and separate so `eval-gate.test.ts`
 * can pin that offline, inside the suite that always runs.
 */

export type EvalGate =
  /** Plain `pnpm test`: the live file stays silent and fully offline. */
  | { kind: 'skip' }
  /** Requested and runnable. */
  | { kind: 'run' }
  /** Requested and NOT runnable. Must surface as a failing test, never as a skip. */
  | { kind: 'fail'; message: string };

export const MISSING_KEY_MESSAGE = [
  '`pnpm eval:parse` was asked to run the live extraction eval, but ANTHROPIC_API_KEY is not set.',
  '',
  'Put the key in .env.local at the repo root:',
  '',
  '    ANTHROPIC_API_KEY=sk-ant-...',
  '',
  'This fails instead of skipping on purpose. docs/DEPLOY.md calls `pnpm eval:parse` the only',
  'check that the extraction actually works, so a skipped run exiting 0 would tick that gate',
  'without having tested anything.',
].join('\n');

/**
 * Takes the whole environment rather than two named fields so `process.env` (an index-signature
 * type) is assignable without a cast at the call site.
 */
export function evalGate(env: Record<string, string | undefined>): EvalGate {
  // Only `pnpm eval:parse` sets this. Without it we are inside `pnpm test`, which must never
  // touch the network — that property is load-bearing for CI and documented in CLAUDE.md.
  if (env.RUN_LIVE_EVAL !== '1') return { kind: 'skip' };

  // Trimmed, because a dotenv line of `ANTHROPIC_API_KEY=` or one with a trailing space parses
  // to a blank string. Passing that to the SDK buys a confusing 401 instead of this message.
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) return { kind: 'fail', message: MISSING_KEY_MESSAGE };

  return { kind: 'run' };
}
