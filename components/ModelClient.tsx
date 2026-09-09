'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  DEFAULT_MONTHS,
  model,
  project,
  sanitizeParams,
  type Params,
} from '@/lib/engine';
import type { ModelState } from '@/lib/schema';
import { changedParams, decodeState, fingerprint, stateToPath } from '@/lib/url';
import { resolveSliders } from '@/lib/sliders';
import { headline } from '@/lib/verdict';
import { money } from '@/lib/format';
import { initAnalytics, track, trackOnce } from '@/lib/analytics';
import TopBar from './TopBar';
import Chart from './Chart';
import SliderPanel from './SliderPanel';
import Verdict from './Verdict';
import Assumptions from './Assumptions';
import { AttributionStrip, DiffPanel, ForkPrompt } from './ForkPieces';

export default function ModelClient() {
  const sp = useSearchParams();
  // Read the URL exactly once. From here on this component owns the state and rewrites the
  // URL itself; re-reading would mean fighting our own replaceState.
  const [boot] = useState(() => ({
    state: decodeState(sp.get('d')),
    /** `new=1` is set only by our own composer, so its absence means somebody shared this. */
    fromLink: sp.get('new') !== '1',
  }));

  if (!boot.state) return <BrokenLink />;
  return <Model initial={boot.state} fromLink={boot.fromLink} />;
}

function Model({ initial, fromLink }: { initial: ModelState; fromLink: boolean }) {
  const months = DEFAULT_MONTHS;

  /** The model as it was shared. A fork of a fork still points at the true original. */
  const originParams = useMemo(() => initial.o ?? initial.p, [initial]);

  const [params, setParams] = useState<Params>(initial.p);
  const [toast, setToast] = useState<string | null>(null);

  const changed = useMemo(() => changedParams(originParams, params), [originParams, params]);
  const diverged = changed.length > 0;
  const isFork = fromLink && diverged;

  // Domains are fixed per session and expand off the parsed value, never off the live one,
  // so the track under your thumb does not rescale while you drag (SPEC 7.1).
  const sliders = useMemo(() => resolveSliders(initial.p), [initial]);

  // Synchronous. No transition, no deferred value, no debounce (SPEC 7.2).
  const { points, derived } = useMemo(() => model(params, months), [params, months]);

  const ghost = useMemo(
    () => (isFork ? project(sanitizeParams(originParams), months) : null),
    [isFork, originParams, months],
  );

  const state: ModelState = useMemo(
    () => ({
      v: 1,
      s: initial.s,
      p: params,
      a: initial.a,
      ...(isFork ? { o: originParams, f: initial.f ?? fingerprint(originParams) } : {}),
    }),
    [initial, params, isFork, originParams],
  );

  useEffect(() => {
    initAnalytics();
    if (fromLink) track('link_opened', { f: initial.f ?? fingerprint(initial.p) });
    else track('model_created', { f: fingerprint(initial.p) });
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The URL rewrite IS debounced, so dragging does not spam history.
  useEffect(() => {
    const t = setTimeout(() => {
      window.history.replaceState(null, '', stateToPath(state));
    }, 300);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const onChange = useCallback(
    (key: keyof Params, value: number) => {
      trackOnce('slider_moved', { from_link: fromLink });
      setParams((prev) => ({ ...prev, [key]: value }));
    },
    [fromLink],
  );

  const shareUrl = useCallback(() => `${window.location.origin}${stateToPath(state)}`, [state]);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl());
      setToast('Link copied');
    } catch {
      setToast('Copy blocked — the link is in your address bar');
    }
    if (diverged) track('fork_saved', { from_link: fromLink, changed });
  }, [shareUrl, diverged, fromLink, changed]);

  const onShare = useCallback(() => {
    const text = `${headline(derived, months)}\n\nHere are the assumptions. Tell me which one is wrong:`;
    if (diverged) track('fork_saved', { from_link: fromLink, changed, via: 'share' });
    window.open(
      `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl())}`,
      '_blank',
      'noopener,noreferrer',
    );
  }, [shareUrl, derived, months, diverged, fromLink, changed]);

  /**
   * Not a gate. The model is already editable — this only puts the reader's cursor on the
   * first thing worth arguing with, because every gate between opening a link and moving a
   * slider costs fork rate (SPEC 5.2).
   */
  const jumpToSliders = useCallback(() => {
    const el = document.getElementById(`ctl-${sliders[0].key}`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.focus({ preventScroll: true });
  }, [sliders]);

  return (
    <>
      <TopBar>
        {toast && <span className="mr-1 text-[12px] text-ink-3">{toast}</span>}
        {fromLink && !diverged ? (
          <button
            type="button"
            onClick={jumpToSliders}
            className="cursor-pointer rounded-[8px] bg-ink px-4 py-[9px] text-[13px] leading-4 font-semibold text-white"
          >
            Fork this model
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onCopy}
              className="cursor-pointer rounded-[8px] border border-line bg-surface px-3.5 py-2 text-[13px] leading-4 font-medium text-ink-2 hover:border-ink-3"
            >
              Copy link
            </button>
            <button
              type="button"
              onClick={onShare}
              className="cursor-pointer rounded-[8px] bg-ink px-3.5 py-2 text-[13px] leading-4 font-semibold text-white"
            >
              Share model
            </button>
          </>
        )}
      </TopBar>

      <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 px-10 py-8">
        {fromLink && <AttributionStrip />}

        {initial.s && (
          <div className="rounded-[8px] border border-line bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <p className="text-[14px] text-ink-2">{initial.s}</p>
              <Link
                href={`/?s=${encodeURIComponent(initial.s)}`}
                className="text-[13px] font-semibold text-accent"
              >
                Edit
              </Link>
            </div>
            {initial.a.length > 0 && (
              <ul className="mt-2.5 flex flex-col gap-1 border-t border-line pt-2.5">
                {initial.a.map((a, i) => (
                  <li key={i} className="text-[13px] leading-[20px] text-ink-3">
                    {a}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <Verdict derived={derived} params={params} months={months} isFork={isFork} />

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="flex flex-col gap-4 rounded-[12px] border border-line bg-surface px-6 py-5 lg:w-[776px] lg:shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-ink">Cash balance</h2>
              {ghost ? (
                <div className="flex items-center gap-4">
                  <Legend color="var(--ghost)" label="Original" />
                  <Legend color="var(--accent)" label="This fork" />
                </div>
              ) : (
                <p className="text-[13px] text-ink-3">
                  {money(params.startingCash)} today &nbsp;·&nbsp; {months} months projected
                </p>
              )}
            </div>
            <Chart
              points={points}
              ghost={ghost}
              runoutMonth={derived.runoutMonth}
              months={months}
            />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <SliderPanel
              params={params}
              sliders={sliders}
              onChange={onChange}
              changed={new Set(changed)}
              onReset={() => setParams(originParams)}
            />
            {/*
              The design puts the diff panel where the sliders live. It has to be both: a
              shared link is read-write immediately and has no view mode (SPEC 5.2), and the
              only number being measured is whether someone moves a slider.
            */}
            {isFork && (
              <DiffPanel
                origin={originParams}
                current={params}
                changed={changed}
                onSave={onCopy}
                saveLabel="Save this fork and share it"
              />
            )}
          </div>
        </div>

        <Assumptions params={params} sliders={sliders} months={months} />

        {fromLink && <ForkPrompt onShare={onShare} />}
      </main>
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-[3px] w-3.5 rounded-[2px]" style={{ background: color }} />
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
    </span>
  );
}

/**
 * A mangled ?d= is somebody's broken link, not an exception. Never an error page (SPEC 4.4).
 */
function BrokenLink() {
  return (
    <>
      <TopBar />
      <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-10 py-24">
        <h1 className="text-[34px] leading-[42px] font-semibold tracking-[-0.68px] text-ink">
          That link did not decode.
        </h1>
        <p className="mt-3 text-[15px] leading-[24px] text-ink-2">
          It was probably truncated somewhere between the person who sent it and you. Nothing was
          lost on our end, because there is no our end — the whole model lives in the link.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex w-fit rounded-[8px] bg-ink px-5 py-3 text-[14px] font-semibold text-white"
        >
          Build one from a sentence
        </Link>
      </main>
    </>
  );
}
