'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DEFAULT_MONTHS, model, project, type Params } from '@/lib/engine';
import type { ModelState } from '@/lib/schema';
import { changedParams, decodeState, fingerprint, stateToPath } from '@/lib/url';
import { resolveSliders } from '@/lib/sliders';
import { headline } from '@/lib/verdict';
import { money } from '@/lib/format';
import {
  initAnalytics,
  markSelfAuthored,
  trackSessionOnce,
  useSelfAuthored,
} from '@/lib/analytics';
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
  const [initial] = useState(() => decodeState(sp.get('d')));

  if (!initial) return <BrokenLink />;
  return <Model initial={initial} />;
}

function Model({ initial }: { initial: ModelState }) {
  const months = DEFAULT_MONTHS;

  /** The model as it was shared. A fork of a fork still points at the true original. */
  const originParams = useMemo(() => initial.o ?? initial.p, [initial]);

  const [params, setParams] = useState<Params>(initial.p);
  const [toast, setToast] = useState<string | null>(null);


  /** Numerator and denominator must share a scope or the ratio compares different things. */
  const scope = useMemo(() => fingerprint(initial.p), [initial]);

  /**
   * "Did somebody else send me this?" Answered from sessionStorage, which our own
   * replaceState cannot erase and a pasted URL cannot carry. The old `new=1` query flag was
   * stripped by the 300ms URL rewrite, so reloading a model you just built counted as an
   * inbound share and inflated the kill metric's denominator. null until knowable, so the
   * origin-dependent chrome waits a tick rather than flashing the wrong state.
   */
  const self = useSelfAuthored(scope);
  const fromLink = self === null ? null : !self;

  const changed = useMemo(() => changedParams(originParams, params), [originParams, params]);
  const diverged = changed.length > 0;
  const isFork = fromLink === true && diverged;

  // Domains are fixed per session and expand off the parsed value, never off the live one,
  // so the track under your thumb does not rescale while you drag (SPEC 7.1).
  const sliders = useMemo(() => resolveSliders(initial.p), [initial]);

  // Synchronous. No transition, no deferred value, no debounce (SPEC 7.2).
  const { points, derived } = useMemo(() => model(params, months), [params, months]);

  const ghost = useMemo(
    // Already validated: it came out of ModelStateSchema, which refines on validateParams.
    () => (isFork ? project(originParams, months) : null),
    [isFork, originParams, months],
  );

  const state: ModelState = useMemo(
    () => ({
      v: 1,
      s: initial.s,
      p: params,
      a: initial.a,
      // Must be re-emitted, or the debounced rewrite quietly drops it 300ms after load and
      // every shared link loses the badge that says which numbers were guessed.
      ...(initial.i && initial.i.length > 0 ? { i: initial.i } : {}),
      // Keep the lineage if it arrived with one, not only once this tab diverges. Opening
      // somebody's fork and re-sharing it untouched used to strip `o` and `f` on the 300ms
      // rewrite, so the ghost curve and the diff vanished and any later edit would diff
      // against the fork instead of the original it came from.
      ...(initial.o || isFork
        ? { o: originParams, f: initial.f ?? fingerprint(originParams) }
        : {}),
    }),
    [initial, params, isFork, originParams],
  );

  // Fires as soon as origin is knowable. trackSessionOnce is idempotent per tab per model,
  // so re-running this effect cannot double-count.
  useEffect(() => {
    initAnalytics();
    if (self === null) return;
    if (self) trackSessionOnce('model_created', scope, { f: scope });
    else trackSessionOnce('link_opened', scope, { f: initial.f ?? scope });
  }, [self, scope, initial.f]);

  // The URL rewrite IS debounced, so dragging does not spam history.
  useEffect(() => {
    const t = setTimeout(() => {
      // Once you diverge, the URL describes a model you made, so claim authorship of it.
      // Without this, reloading your own fork counted as somebody opening a shared link and
      // added a denominator the fork rate never earned. Only on divergence: the model as it
      // arrived stays somebody else's.
      if (diverged) markSelfAuthored(fingerprint(params));
      window.history.replaceState(null, '', stateToPath(state));
    }, 300);
    return () => clearTimeout(t);
  }, [state, diverged, params]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const onChange = useCallback(
    (key: keyof Params, value: number) => {
      trackSessionOnce('slider_moved', scope, { from_link: fromLink === true });
      setParams((prev) => ({ ...prev, [key]: value }));
    },
    [fromLink, scope],
  );

  const shareUrl = useCallback(() => `${window.location.origin}${stateToPath(state)}`, [state]);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl());
      setToast('Link copied');
    } catch {
      setToast('Copy blocked — the link is in your address bar');
    }
    // Keyed on the fork's own fingerprint: copying then posting the same version is one
    // fork, but genuinely different forks in the same tab each count.
    if (diverged) {
      trackSessionOnce('fork_saved', fingerprint(params), {
        from_link: fromLink === true,
        changed,
      });
    }
  }, [shareUrl, diverged, fromLink, changed, params]);

  const onShare = useCallback(() => {
    const text = `${headline(derived, months)}\n\nHere are the assumptions. Tell me which one is wrong:`;
    if (diverged) {
      trackSessionOnce('fork_saved', fingerprint(params), {
        from_link: fromLink === true,
        changed,
        via: 'share',
      });
    }
    window.open(
      `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl())}`,
      '_blank',
      'noopener,noreferrer',
    );
  }, [shareUrl, derived, months, diverged, fromLink, changed, params]);

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
        {fromLink === null ? null : fromLink && !diverged ? (
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
        {fromLink === true && <AttributionStrip />}

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

        <Assumptions
          params={params}
          sliders={sliders}
          months={months}
          // Carried through the URL so a shared model still shows which numbers were guessed.
          inferred={initial.i ?? []}
        />

        {fromLink === true && <ForkPrompt onShare={onShare} />}
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
