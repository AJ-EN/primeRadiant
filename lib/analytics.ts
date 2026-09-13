'use client';

/**
 * The kill metric is the only number this product is judged on, so the events matter more
 * than the pageviews.
 *
 * UNIT OF ANALYSIS: one browser tab, one model. Both the numerator (`slider_moved`) and the
 * denominator (`link_opened`) are counted at most once per tab per model, via sessionStorage,
 * which survives a reload and dies with the tab. A module-level Set counts page loads
 * instead, which silently made reloads look like new visitors.
 *
 * No-ops entirely without NEXT_PUBLIC_POSTHOG_KEY, so local dev never sends anything.
 */
import { useSyncExternalStore } from 'react';
import posthog from 'posthog-js';
import { redactProperties } from './redact';

export type Event =
  /** A model was produced from a sentence. Fired once, by the page that renders it. */
  | 'model_created'
  /** Somebody who did not author this model in this tab opened it. Kill-metric denominator. */
  | 'link_opened'
  /** First slider move for this model in this tab. Kill-metric numerator. */
  | 'slider_moved'
  /** A modified link was copied or posted. Keyed per distinct fork. */
  | 'fork_saved'
  /** The parser could not ground a field and the UI had to ask. */
  | 'clarifier_shown'
  /** The parse failed and the manual-entry fallback was shown. */
  | 'parse_failed';

/**
 * The measurement run this build belongs to. See docs/MEASUREMENT.md.
 *
 * Attached to every event so a sample can never be pooled across builds by accident. Bump it
 * whenever something that could move the funnel changes: the composer, the model page, the
 * slider panel, the analytics themselves, or a fix to any of them. A result computed across
 * two different runs is not a result.
 *
 * The `-pilot` suffix is load-bearing, not decoration. Starting cold, the first public post
 * cannot reach the 100-open floor — so it ships as a pilot that proves the instrument, and
 * the kill-metric run stays unspent until a channel exists that can fill the denominator.
 * Pilot events must never be pooled with that run, and a distinct id is what makes that
 * structural rather than a thing somebody has to remember. Bump to a plain dated id when the
 * real run starts (D1b in docs/MEASUREMENT.md).
 */
export const MEASUREMENT_RUN = '2026-09-13-pilot';

let started = false;

export function initAnalytics() {
  if (started || typeof window === 'undefined') return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    capture_pageview: true,
    // Nobody ever logs in, so identified profiles would only link a real person to their
    // financials for no analytical gain. Events still carry a session id, which is all the
    // funnel needs.
    person_profiles: 'identified_only',
    // The ?d= payload is the founder's sentence and cash position, reversible by anyone.
    // Without this it lands in a third party and "nothing is stored" stops being true.
    sanitize_properties: redactProperties,
  });
  started = true;
}

export function track(event: Event, props?: Record<string, unknown>) {
  if (!started) return;
  posthog.capture(event, { ...props, run: MEASUREMENT_RUN });
}

/** Private mode and blocked storage throw on access; degrade to per-page-load instead. */
const memoryFired = new Set<string>();

function claim(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const store = window.sessionStorage;
    if (store.getItem(key) !== null) return false;
    store.setItem(key, '1');
    return true;
  } catch {
    if (memoryFired.has(key)) return false;
    memoryFired.add(key);
    return true;
  }
}

/**
 * Fire at most once per tab, per scope. `scope` is the model fingerprint, so two genuinely
 * different forks each count, while reloading one of them does not.
 */
export function trackSessionOnce(
  event: Event,
  scope: string,
  props?: Record<string, unknown>,
) {
  if (!claim(`pr:evt:${event}:${scope}`)) return;
  track(event, props);
}

/**
 * Origin tracking, deliberately not in the URL.
 *
 * The previous approach marked self-authored models with a `new=1` query param, but the
 * debounced `replaceState` rewrote the URL without it 300ms later. Any reload then
 * reclassified the author as an inbound visitor and inflated the denominator, biasing fork
 * rate down, toward the kill threshold. sessionStorage cannot be rewritten by our own
 * navigation and cannot be pasted into someone else's browser.
 */
const selfAuthored = new Set<string>();

export function markSelfAuthored(scope: string) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`pr:self:${scope}`, '1');
  } catch {
    selfAuthored.add(scope);
  }
}

function isSelfAuthored(scope: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(`pr:self:${scope}`) === '1';
  } catch {
    return selfAuthored.has(scope);
  }
}

/** A no-op: nothing mutates this key after the tab that wrote it navigated away. */
const noopSubscribe = () => () => {};

/**
 * Did this tab author this model? Returns null until it is knowable.
 *
 * Read through useSyncExternalStore so the server and client answers are explicit rather
 * than accidental. The server has no sessionStorage, so it must answer "not known"; deriving
 * this in a useState initializer instead made the server paint the stranger UI while the
 * client computed "author", and the two never reconciled. Callers render origin-dependent
 * chrome only once this is non-null.
 */
export function useSelfAuthored(scope: string): boolean | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => isSelfAuthored(scope),
    () => null,
  );
}
