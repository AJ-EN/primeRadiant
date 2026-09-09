'use client';

import type { Params } from '@/lib/engine';
import { count } from '@/lib/format';
import { SLIDERS } from '@/lib/sliders';

const LABELS: Record<keyof Params, string> = {
  customers: 'Customers today',
  ...(Object.fromEntries(SLIDERS.map((s) => [s.key, s.label])) as Record<
    Exclude<keyof Params, 'customers'>,
    string
  >),
};

const FORMATTERS = Object.fromEntries(SLIDERS.map((s) => [s.key, s.format])) as Partial<
  Record<keyof Params, (v: number) => string>
>;

const show = (k: keyof Params, v: number) => (FORMATTERS[k] ?? count)(v);

const ALL_KEYS = Object.keys(LABELS) as (keyof Params)[];

/**
 * No opens or forks count: those need a database, and v0 has none (SPEC 2). The one line
 * that has to land is that this is yours and the original is untouched.
 */
export function AttributionStrip() {
  return (
    <div className="flex w-full flex-wrap items-center gap-2.5 rounded-[8px] border border-line bg-sunk px-4 py-2.5 text-[12px]">
      <span className="font-semibold tracking-[0.24px] text-ink">Shared model</span>
      <span className="text-ink-3">·</span>
      <span className="text-ink-2">you are editing your own copy</span>
      <span className="text-ink-3">·</span>
      <span className="text-ink-3">nothing you change here affects the original</span>
    </div>
  );
}

export function DiffPanel({
  origin,
  current,
  changed,
  onSave,
  saveLabel,
}: {
  origin: Params;
  current: Params;
  changed: readonly (keyof Params)[];
  onSave: () => void;
  saveLabel: string;
}) {
  const unchanged = ALL_KEYS.filter((k) => !changed.includes(k));

  return (
    <div className="flex flex-col gap-[18px] rounded-[12px] border border-line bg-surface p-4 sm:p-5">
      <p className="text-[11px] font-semibold tracking-[0.88px] text-ink-3">WHAT YOU CHANGED</p>

      {changed.map((k) => (
        <div key={k} className="flex flex-col gap-1.5">
          <p className="text-[13px] font-medium text-ink-2">{LABELS[k]}</p>
          <div
            className="flex items-center gap-2"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            <span className="text-[15px] text-ink-3 line-through">{show(k, origin[k])}</span>
            <span aria-hidden className="text-[13px] text-ink-3">
              →
            </span>
            <span className="text-[17px] font-semibold text-accent">{show(k, current[k])}</span>
          </div>
        </div>
      ))}

      {unchanged.length > 0 && (
        <>
          <div className="h-px w-full bg-line-soft" />
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold tracking-[0.88px] text-ink-3">UNCHANGED</p>
            {unchanged.map((k) => (
              <div key={k} className="flex items-start justify-between text-[13px]">
                <span className="text-ink-2">{LABELS[k]}</span>
                <span
                  className="font-medium text-ink"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {show(k, current[k])}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <button
        type="button"
        onClick={onSave}
        className="w-full cursor-pointer rounded-[8px] bg-ink py-3 text-[14px] font-semibold text-white"
      >
        {saveLabel}
      </button>
    </div>
  );
}

export function ForkPrompt({ onShare }: { onShare: () => void }) {
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-4 rounded-[12px] border border-line bg-sunk px-4 py-4 sm:px-6 sm:py-[18px]">
      <p className="text-[14px] font-medium text-ink">
        Think an assumption is wrong? Change it and post your version. That is the whole point.
      </p>
      <button
        type="button"
        onClick={onShare}
        className="cursor-pointer rounded-[8px] border-[1.5px] border-ink bg-surface px-4 py-[9px] text-[13px] font-semibold text-ink"
      >
        Post your version
      </button>
    </div>
  );
}
