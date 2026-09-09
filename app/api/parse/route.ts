import Anthropic from '@anthropic-ai/sdk';
import { extractFromSentence } from '@/lib/extract';
import { SENTENCE_MAX } from '@/lib/schema';

/** The only cost surface in the product. Everything else is arithmetic in the browser. */
export const runtime = 'nodejs';

/**
 * IP token bucket, 20/hour. In-memory, so it resets on cold start and is per-instance — it
 * stops a naive scraper, not a determined one. The real backstop is a spend cap on the key.
 */
const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = 20;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now > b.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
    }
    return false;
  }
  b.count += 1;
  return b.count > LIMIT;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

export async function POST(req: Request) {
  let sentence: string;
  try {
    const body = await req.json();
    sentence = String(body?.sentence ?? '').trim();
  } catch {
    return Response.json({ ok: false, reason: 'bad_input' }, { status: 400 });
  }

  // Matches the wire limit: parsing more than the URL can carry just wastes a call.
  if (sentence.length < 8 || sentence.length > SENTENCE_MAX) {
    return Response.json({ ok: false, reason: 'bad_input' }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // Not an error page. The client falls back to manual entry (SPEC 4.4).
    return Response.json({ ok: false, reason: 'no_key' }, { status: 503 });
  }

  if (rateLimited(clientIp(req))) {
    return Response.json({ ok: false, reason: 'rate_limited' }, { status: 429 });
  }

  try {
    const interpreted = await extractFromSentence(sentence);
    if (!interpreted.ok) {
      return Response.json({ ok: false, reason: interpreted.reason }, { status: 200 });
    }
    return Response.json({ ok: true, result: interpreted.result });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ ok: false, reason: 'rate_limited' }, { status: 429 });
    }
    console.error('[parse]', err instanceof Error ? err.message : err);
    return Response.json({ ok: false, reason: 'parse_failed' }, { status: 200 });
  }
}
