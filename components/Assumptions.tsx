'use client';

/**
 * Always visible, never collapsed (SPEC 11): a model that gets screenshotted has to carry
 * its assumptions in the same frame.
 *
 * These lines are generated from the CURRENT params, not from the parser's prose. The
 * parser's sentences describe the sentence you typed and go stale the instant you drag a
 * slider — showing stale claims beside a live chart is exactly the confidently-wrong failure
 * mode this block exists to prevent. The parser's reading lives up in the echo strip instead.
 */
import type { Params } from '@/lib/engine';
import { count } from '@/lib/format';
import type { SliderSpec } from '@/lib/sliders';

type Props = {
  params: Params;
  sliders: SliderSpec[];
  /** Param keys the parser defaulted rather than read from your sentence. */
  inferred?: readonly string[];
  months: number;
};

function focusControl(key: string) {
  const el = document.getElementById(`ctl-${key}`);
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el?.focus({ preventScroll: true });
}

export default function Assumptions({ params, sliders, inferred = [], months }: Props) {
  const lines = [
    { key: 'customers', text: `You have ${count(params.customers)} paying customers today.` },
    ...sliders.map((s) => ({ key: s.key as string, text: s.claim(params[s.key]) })),
  ];

  const half = Math.ceil(lines.length / 2);
  const columns = [lines.slice(0, half), lines.slice(half)];

  return (
    <section className="rounded-[12px] border border-line bg-sunk px-4 pt-4 pb-5 sm:px-6 sm:pt-5 sm:pb-[22px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink">What the model assumed</h2>
        <p className="text-[13px] text-ink-3">
          This is the part worth arguing about. Change any line.
        </p>
      </div>

      <div className="mt-[18px] flex flex-col gap-[14px] sm:flex-row sm:gap-9">
        {columns.map((col, ci) => (
          <div key={ci} className="flex flex-1 flex-col gap-[14px]">
            {col.map((l, i) => {
              const n = ci * half + i + 1;
              return (
                <div key={l.key} className="flex gap-3">
                  <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full border border-line bg-surface text-[11px] font-semibold text-ink-2">
                    {n}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="text-[14px] leading-[22px] text-ink">
                      {l.text}
                      {inferred.includes(l.key) && (
                        <span
                          className="ml-1.5 rounded-sm bg-surface px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-danger"
                          title="Your sentence did not say this. It is a default, not a reading."
                        >
                          we guessed this
                        </span>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => focusControl(l.key)}
                      className="w-fit cursor-pointer text-[12px] font-medium text-accent"
                    >
                      change this
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <p className="mt-5 border-t border-line pt-4 text-[13px] leading-[21px] text-ink-3">
        The projection runs {months} months and assumes no new funding, no one-off costs, and no
        change to anything above. The arithmetic is three lines, run once per month: churn the
        base you had, add the new signups, collect the revenue, subtract the burn. No model
        predicted any of these numbers — you did.
      </p>
    </section>
  );
}
