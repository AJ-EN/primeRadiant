import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { PARAM_KEYS, ParseResultSchema, normalizeParseResult } from '@/lib/schema';

/** The only cost surface in the product. Everything else is arithmetic in the browser. */
export const runtime = 'nodejs';

const MODEL = 'claude-haiku-4-5';

/**
 * Enough for six numbers and four sentences with room to spare. The spec says 400; 600 buys
 * headroom against a truncated response, which fails the parse entirely, for about $0.0015.
 */
const MAX_TOKENS = 600;

const SYSTEM = `You extract structured business parameters from a sentence. You are a parser, not an analyst. You never compute, project, or advise.

Rules:
- NEVER invent a value that is not stated or directly implied by the sentence. If it is not there, return null for that field and list its key in "missing".
- "18k" means 18000. "1.2m" means 1200000. "9.5k a month" of spending is monthlyBurn.
- A churn percentage becomes a decimal: 8% -> 0.08.
- newPerMonth is an ABSOLUTE count of new customers per month. If the sentence gives a growth RATE instead ("growing 20% a month"), you cannot convert it: return null and put "newPerMonth" in "missing".
- price is revenue per customer per month. If a sentence gives an annual price, divide by 12 and say so in an assumption.
- "inferred" lists keys you filled with a defensible default rather than read from the sentence. A key cannot be in both "missing" and "inferred".
- "assumptions" are 3 to 5 plain English sentences a non-technical founder could read and disagree with. Name the specific numbers. Do not hedge, do not add caveats about the model itself, do not mention that you are an AI.

Return every one of the six numeric keys, using null where the sentence does not ground them.`;

/**
 * The wire shape the model fills in. Deliberately looser than ParseResultSchema — every field
 * required, no constraints — because a structured-output schema that the model cannot satisfy
 * fails the whole call. Range checking is our job, on the way back.
 */
const ExtractionSchema = z.object({
  startingCash: z.number().nullable(),
  monthlyBurn: z.number().nullable(),
  customers: z.number().nullable(),
  price: z.number().nullable(),
  churn: z.number().nullable(),
  newPerMonth: z.number().nullable(),
  missing: z.array(z.enum(PARAM_KEYS)),
  inferred: z.array(z.enum(PARAM_KEYS)),
  assumptions: z.array(z.string()),
});

/**
 * IP token bucket, 20/hour. In-memory, so it resets on cold start and is per-instance — it
 * stops a naive scraper, not a determined one. Move to Vercel KV before this sees real traffic.
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

/** Belt and braces: if structured output ever hands back raw text, strip fences and try anyway. */
function salvageJson(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let sentence: string;
  try {
    const body = await req.json();
    sentence = String(body?.sentence ?? '').trim();
  } catch {
    return Response.json({ ok: false, reason: 'bad_input' }, { status: 400 });
  }

  if (sentence.length < 8 || sentence.length > 600) {
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
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: 'user', content: sentence }],
      output_config: { format: zodOutputFormat(ExtractionSchema) },
    });

    let raw: unknown = response.parsed_output;
    if (!raw) {
      const text = response.content.find((b) => b.type === 'text');
      raw = text ? salvageJson(text.text) : null;
    }
    if (!raw) return Response.json({ ok: false, reason: 'parse_failed' }, { status: 200 });

    const validated = ParseResultSchema.safeParse(raw);
    if (!validated.success) {
      return Response.json({ ok: false, reason: 'parse_failed' }, { status: 200 });
    }

    return Response.json({ ok: true, result: normalizeParseResult(validated.data) });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ ok: false, reason: 'rate_limited' }, { status: 429 });
    }
    console.error('[parse]', err instanceof Error ? err.message : err);
    return Response.json({ ok: false, reason: 'parse_failed' }, { status: 200 });
  }
}
