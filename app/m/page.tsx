import { Suspense } from 'react';
import type { Metadata } from 'next';
import ModelClient from '@/components/ModelClient';
import { DEFAULT_MONTHS } from '@/lib/engine';
import { shareCard } from '@/lib/share';
import { decodeState } from '@/lib/url';

/**
 * Reading `searchParams` here makes this route dynamic, which is the point.
 *
 * As a client component reading `useSearchParams`, `/m` was prerendered static: every shared
 * link served one identical 7KB shell with no `og:` tags, so X, Slack, Discord and iMessage
 * all showed the same generic card. The verdict, which is the entire reason somebody would
 * click, was invisible to the thing doing the sharing. That suppressed `link_opened` at the
 * source, which would have made a low fork rate indistinguishable from a broken funnel.
 *
 * The cost is a function invocation per link open instead of a CDN hit. At validation volume
 * that is free, the work is pure arithmetic with no I/O, and it also kills the blank shell.
 */
/**
 * Shown when the payload is missing, mangled, or over the byte budget. It still carries a
 * card: a truncated link is somebody's broken share, and it lands in exactly the channel
 * this product depends on, so a bare unadorned URL is the worst possible outcome there.
 * `/api/og` with no payload renders the generic version.
 */
const FALLBACK_TITLE = 'A runway model you can argue with';
const FALLBACK_DESCRIPTION =
  'One sentence about your business becomes a live cash model with every assumption on the page.';

const FALLBACK: Metadata = {
  title: FALLBACK_TITLE,
  description: FALLBACK_DESCRIPTION,
  openGraph: {
    type: 'website',
    title: FALLBACK_TITLE,
    description: FALLBACK_DESCRIPTION,
    images: [{ url: '/api/og', width: 1200, height: 630, alt: FALLBACK_TITLE }],
  },
  twitter: {
    card: 'summary_large_image',
    title: FALLBACK_TITLE,
    description: FALLBACK_DESCRIPTION,
    images: ['/api/og'],
  },
};

export async function generateMetadata({
  searchParams,
}: PageProps<'/m'>): Promise<Metadata> {
  const { d } = await searchParams;
  const payload = typeof d === 'string' ? d : undefined;
  const state = decodeState(payload);
  if (!payload || !state) return FALLBACK;

  // Only the six numbers cross this line. `shareCard` cannot see the sentence or the
  // assumption strings, so no text written by a link's author reaches a preview card
  // carrying our domain.
  const card = shareCard(state.p, DEFAULT_MONTHS);
  const image = `/api/og?d=${payload}`;

  return {
    title: card.headline,
    description: card.description,
    openGraph: {
      type: 'website',
      title: card.headline,
      description: card.description,
      images: [{ url: image, width: 1200, height: 630, alt: card.headline }],
    },
    twitter: {
      card: 'summary_large_image',
      title: card.headline,
      description: card.description,
      images: [image],
    },
  };
}

/** The model, the shared view and the fork are three states of this one page, not three routes. */
export default function ModelPage() {
  return (
    <Suspense>
      <ModelClient />
    </Suspense>
  );
}
