'use client';

/**
 * The kill metric is the only number this product is being judged on, so the events
 * matter more than the pageviews. Fork rate = slider_moved / link_opened, among sessions
 * that arrived via a shared link.
 *
 * No-ops entirely without NEXT_PUBLIC_POSTHOG_KEY, so local dev is never sending anything.
 */
import posthog from 'posthog-js';

export type Event =
  /** A model was produced from a sentence. */
  | 'model_created'
  /** The page was opened with a ?d= payload — i.e. somebody followed a shared link. */
  | 'link_opened'
  /** First slider move of the session only. The numerator of the kill metric. */
  | 'slider_moved'
  /** A modified link was copied. */
  | 'fork_saved'
  /** The parser could not ground a field and the UI had to ask. */
  | 'clarifier_shown'
  /** The parse failed and the manual-entry fallback was shown. */
  | 'parse_failed';

let started = false;

export function initAnalytics() {
  if (started || typeof window === 'undefined') return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    capture_pageview: true,
    person_profiles: 'always',
  });
  started = true;
}

export function track(event: Event, props?: Record<string, unknown>) {
  if (!started) return;
  posthog.capture(event, props);
}

/** `slider_moved` counts once per session, or the ratio is meaningless. */
const fired = new Set<string>();
export function trackOnce(event: Event, props?: Record<string, unknown>) {
  if (fired.has(event)) return;
  fired.add(event);
  track(event, props);
}
