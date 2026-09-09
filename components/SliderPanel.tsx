'use client';

import { useCallback } from 'react';
import type { Params } from '@/lib/engine';
import { count } from '@/lib/format';
import { POS_STEPS, posToValue, valueToPos, type SliderSpec } from '@/lib/sliders';

type Props = {
  params: Params;
  sliders: SliderSpec[];
  /** Called synchronously on every `input` event. Do not debounce this (SPEC 7.2). */
  onChange: (key: keyof Params, value: number) => void;
  /** Params this fork has moved away from the original. Marked, never locked. */
  changed?: ReadonlySet<keyof Params>;
  onReset?: () => void;
};

export default function SliderPanel({ params, sliders, onChange, changed, onReset }: Props) {
  /**
   * Chrome and Safari adjust a hovered range input on wheel, so scrolling past this panel
   * silently rewrites the model under the reader. React's onWheel is registered passive at
   * the root and cannot preventDefault, so the listener has to be attached directly.
   */
  const blockWheel = useCallback((el: HTMLInputElement | null) => {
    if (!el) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  const changedCount = sliders.filter((s) => changed?.has(s.key)).length;

  return (
    <div className="rounded-[12px] border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-[11px] font-semibold tracking-[0.88px] text-ink-3">
          PULL AN ASSUMPTION
        </h2>
        <p className="text-[13px] text-ink-2">The chart redraws as you drag.</p>
      </div>

      <div className="mt-[22px] flex flex-col gap-[22px]">
        {sliders.map((s) => {
          const value = params[s.key];
          const pos = valueToPos(value, s);
          return (
            <div key={s.key} className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <label htmlFor={`ctl-${s.key}`} className="text-[13px] font-medium text-ink-2">
                  {s.label}
                  {changed?.has(s.key) && (
                    <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />
                  )}
                </label>
                <span
                  className="text-[15px] font-semibold text-ink"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {s.format(value)}
                </span>
              </div>
              <input
                id={`ctl-${s.key}`}
                ref={blockWheel}
                type="range"
                min={0}
                max={POS_STEPS}
                step={1}
                value={pos}
                aria-label={s.label}
                aria-valuetext={s.format(value)}
                onChange={(e) => onChange(s.key, posToValue(Number(e.target.value), s))}
                style={{ ['--fill' as string]: `${(pos / POS_STEPS) * 100}%` }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-[22px] flex items-center justify-between">
        <button
          type="button"
          onClick={onReset}
          disabled={changedCount === 0}
          className="cursor-pointer text-[13px] font-medium text-accent disabled:cursor-default disabled:text-ink-3"
        >
          Reset to original
        </button>
        <span className="text-[12px] text-ink-3">
          {changedCount} of {sliders.length} changed
        </span>
      </div>

      {/*
        Customers today is not a slider — the design has exactly five, and how many customers
        you have is a fact about the business rather than an assumption to drag. A fork still
        has to be able to disagree with it, so it stays editable here, visually subordinate.
      */}
      <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
        <label htmlFor="ctl-customers" className="text-[13px] font-medium text-ink-2">
          Customers today
          {changed?.has('customers') && (
            <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />
          )}
        </label>
        <input
          id="ctl-customers"
          type="number"
          min={0}
          step={1}
          value={Number.isInteger(params.customers) ? params.customers : count(params.customers)}
          onChange={(e) => onChange('customers', Math.max(0, Number(e.target.value) || 0))}
          className="w-20 rounded-[8px] border border-line bg-paper px-2 py-1 text-right text-[15px] font-semibold text-ink outline-none focus:border-ink"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        />
      </div>
    </div>
  );
}
