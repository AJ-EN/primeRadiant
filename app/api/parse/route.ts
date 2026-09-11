import { extractFromSentence } from '@/lib/extract';
import { MODEL, type ParseFailure } from '@/lib/parse';
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

/**
 * One structured line per parse, whatever the outcome.
 *
 * Before this the server said `console.error('[parse]', message)` and nothing else, so the
 * two questions that matter — how many parses succeed, and what the failures actually are —
 * were both unanswerable. This is simultaneously the cost surface and the top of the funnel.
 *
 * The sentence itself is never logged, only its length. It is the founder's cash position in
 * plain text, and putting it in a log would recreate exactly the leak the PostHog redaction
 * closed.
 */
function logParse(
  outcome: 'ok' | ParseFailure,
  startedAt: number,
  chars: number,
  detail?: string,
) {
  const line = JSON.stringify({
    evt: 'parse',
    outcome,
    ms: Date.now() - startedAt,
    chars,
    model: MODEL,
    ...(detail ? { detail } : {}),
  });

  // Split so an operator can filter for the ones they have to act on. A rate limit or a
  // short sentence is the system working; a rejected key or a truncated reply is not.
  const actionable: string[] = ['key_rejected', 'unavailable', 'truncated', 'parse_failed'];
  if (actionable.includes(outcome)) console.error(line);
  else console.log(line);
}

export async function POST(req: Request) {
  const startedAt = Date.now();

  let sentence: string;
  try {
    const body = await req.json();
    sentence = String(body?.sentence ?? '').trim();
  } catch {
    logParse('bad_input', startedAt, 0, 'body not json');
    return Response.json({ ok: false, reason: 'bad_input' }, { status: 400 });
  }

  // Matches the wire limit: parsing more than the URL can carry just wastes a call.
  if (sentence.length < 8 || sentence.length > SENTENCE_MAX) {
    logParse('bad_input', startedAt, sentence.length, 'length');
    return Response.json({ ok: false, reason: 'bad_input' }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // Not an error page. The client falls back to manual entry (SPEC 4.4).
    logParse('no_key', startedAt, sentence.length);
    return Response.json({ ok: false, reason: 'no_key' }, { status: 503 });
  }

  if (rateLimited(clientIp(req))) {
    logParse('rate_limited', startedAt, sentence.length, 'local bucket');
    return Response.json({ ok: false, reason: 'rate_limited' }, { status: 429 });
  }

  // extractFromSentence never throws: every outcome comes back named.
  const extracted = await extractFromSentence(sentence);

  if (!extracted.ok) {
    logParse(extracted.reason, startedAt, sentence.length, extracted.detail);
    // 429 keeps its status so it stays visible in access logs. Everything else is a 200 with
    // a named reason, because the client's answer is always the manual form, never an error
    // page.
    const status = extracted.reason === 'rate_limited' ? 429 : 200;
    return Response.json({ ok: false, reason: extracted.reason }, { status });
  }

  logParse('ok', startedAt, sentence.length, extracted.detail);
  return Response.json({ ok: true, result: extracted.result });
}
