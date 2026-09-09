'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  validateParams,
  type FieldIssue,
  type ParamKey,
  type Params,
} from '@/lib/engine';
import {
  ASSUMPTION_COUNT_MAX,
  PARAM_KEYS,
  SENTENCE_MAX,
  type ModelState,
  type ParseResult,
} from '@/lib/schema';
import { fingerprint, stateToPath } from '@/lib/url';
import { initAnalytics, markSelfAuthored, track } from '@/lib/analytics';

const EXAMPLES = [
  {
    chip: 'Solo consultant',
    sentence:
      "I've got $12k in the bank, spend about $3.5k a month, and 4 retainer clients paying $1,800 each. I lose around 5% a month and sign one new client a month.",
  },
  {
    chip: 'Pre-seed SaaS',
    sentence:
      '18k in the bank, 9.5k a month burn, 12 customers paying 400, about 8% churn, 2 new customers a month',
  },
  {
    chip: 'Ecom store',
    sentence:
      '$40k cash, $11k of monthly costs, 320 subscribers at $29 a month, 12% cancel each month, and roughly 45 new subscribers a month.',
  },
];

/** One question per field, phrased the way the founder would answer it out loud. */
const QUESTIONS: Record<ParamKey, string> = {
  startingCash: 'How much cash do you have in the bank right now?',
  monthlyBurn: 'What do you spend in a typical month?',
  customers: 'How many paying customers do you have today?',
  price: 'What does one customer pay you per month?',
  churn: 'What share of your customers cancel in a typical month?',
  newPerMonth: 'How many new customers do you add in a typical month?',
};

const PREFIX: Partial<Record<ParamKey, string>> = {
  startingCash: '$',
  monthlyBurn: '$',
  price: '$',
};
const SUFFIX: Partial<Record<ParamKey, string>> = { churn: '%' };

/**
 * "I don't know" is only offered where a default is genuinely defensible, and the reason is
 * shown before you accept it. The money fields have no honest default: if you cannot say
 * what you have in the bank, there is no runway model to draw, and inventing one is the
 * exact failure this product exists to avoid. Anything taken from here is flagged as a
 * guess for the life of the model.
 */
const UNKNOWN_DEFAULTS: Partial<Record<ParamKey, { value: number; because: string }>> = {
  churn: {
    value: 0.05,
    because: '5% a month, a common early-stage subscription figure',
  },
  customers: {
    value: 0,
    because: 'zero, on the assumption nobody is paying you yet',
  },
};

/**
 * One note per failure, and each one has to be true. Telling someone their sentence could not
 * be read when the parser was never called is the same confidently-wrong move the whole
 * product exists to avoid.
 */
const NOTES: Record<string, string> = {
  no_key:
    'Reading sentences is switched off on this build. The model itself works exactly the same — it just needs the six numbers from you.',
  rate_limited: 'That is a lot of models in one hour. Fill the six numbers in yourself and carry on.',
  parse_failed: 'That sentence did not read cleanly. Six numbers and you are through.',
  bad_input: 'That sentence was too short to read. Six numbers and you are through.',
  network: 'That request did not make it out of the browser. Six numbers and you are through.',
};

type Stage =
  | { kind: 'idle' }
  | { kind: 'parsing' }
  /** The parser refused to guess. Ask, do not default (SPEC 4.2). */
  | { kind: 'clarify'; result: ParseResult; keys: ParamKey[] }
  /** The parse failed outright. Never an error page — just the six fields, empty. */
  | { kind: 'manual'; note: string };

export default function Composer() {
  const router = useRouter();
  const sp = useSearchParams();
  const [sentence, setSentence] = useState(() => sp.get('s') ?? '');
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [drafts, setDrafts] = useState<Partial<Record<ParamKey, string>>>({});
  const [unknowns, setUnknowns] = useState<ParamKey[]>([]);
  const [issues, setIssues] = useState<FieldIssue[]>([]);

  useEffect(() => {
    initAnalytics();
  }, []);

  function go(params: Params, assumptions: string[], inferred: ParamKey[]) {
    const state: ModelState = {
      v: 1,
      s: sentence.trim(),
      p: params,
      a: assumptions.slice(0, ASSUMPTION_COUNT_MAX),
      // Omitted when empty so an honest model does not pay for the field in URL bytes.
      ...(inferred.length > 0 ? { i: inferred } : {}),
    };
    markSelfAuthored(fingerprint(params));
    router.push(stateToPath(state));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const s = sentence.trim();
    if (s.length < 8) return;
    setStage({ kind: 'parsing' });

    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sentence: s }),
      });
      const data = await res.json();

      if (!data?.ok) {
        track('parse_failed', { reason: data?.reason });
        setStage({ kind: 'manual', note: NOTES[data?.reason] ?? NOTES.parse_failed });
        return;
      }

      const result: ParseResult = data.result;
      if (result.missing.length > 0) {
        track('clarifier_shown', { missing: result.missing });
        setStage({ kind: 'clarify', result, keys: result.missing });
        return;
      }

      const validated = validateParams(result as unknown as Partial<Record<ParamKey, unknown>>);
      if (!validated.ok) {
        // The parser produced a number outside the bounds. Do not repair it, ask.
        track('parse_failed', { reason: 'out_of_bounds' });
        setStage({ kind: 'clarify', result, keys: validated.issues.map((i) => i.key) });
        setIssues(validated.issues);
        return;
      }
      go(validated.params, result.assumptions, result.inferred);
    } catch {
      track('parse_failed', { reason: 'network' });
      setStage({ kind: 'manual', note: NOTES.network });
    }
  }

  /** Percent in the field, decimal in the model. Unknown fields use the stated default. */
  function readField(k: ParamKey): unknown {
    if (unknowns.includes(k)) return UNKNOWN_DEFAULTS[k]?.value;
    const raw = drafts[k];
    if (raw === undefined || raw.trim() === '') return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw;
    return k === 'churn' ? n / 100 : n;
  }

  function toggleUnknown(k: ParamKey) {
    setUnknowns((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
    setIssues((prev) => prev.filter((i) => i.key !== k));
  }

  function onFieldsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (stage.kind !== 'clarify' && stage.kind !== 'manual') return;

    const asked = stage.kind === 'clarify' ? stage.keys : [...PARAM_KEYS];
    const base: Partial<Record<ParamKey, unknown>> =
      stage.kind === 'clarify'
        ? Object.fromEntries(PARAM_KEYS.map((k) => [k, (stage.result as Record<string, unknown>)[k]]))
        : {};

    for (const k of asked) base[k] = readField(k);

    const validated = validateParams(base);
    if (!validated.ok) {
      setIssues(validated.issues);
      return;
    }

    // Everything the parser defaulted, plus everything the reader said they did not know.
    const parserInferred = stage.kind === 'clarify' ? stage.result.inferred : [];
    const inferred = [...new Set<ParamKey>([...parserInferred, ...unknowns])];
    go(validated.params, stage.kind === 'clarify' ? stage.result.assumptions : [], inferred);
  }

  if (stage.kind === 'clarify' || stage.kind === 'manual') {
    const keys = stage.kind === 'clarify' ? stage.keys : [...PARAM_KEYS];
    return (
      <form onSubmit={onFieldsSubmit} className="flex w-full flex-col gap-5" noValidate>
        <p className="text-[11px] font-semibold tracking-[1.1px] text-ink-3">STEP 2</p>
        <h1 className="text-[38px] leading-[46px] font-semibold tracking-[-0.76px] text-ink">
          {stage.kind === 'clarify'
            ? keys.length === 1
              ? 'One thing your sentence did not say.'
              : `${keys.length} things your sentence did not say.`
            : 'Let us do this the short way.'}
        </h1>
        <p className="max-w-[640px] text-[16px] leading-[26px] text-ink-2">
          {stage.kind === 'clarify'
            ? 'It would be easy to guess these. A guessed number that looks like a read one is the whole reason nobody trusts tools like this, so it is asking instead.'
            : stage.note}
        </p>

        <div className="flex flex-col gap-5 rounded-[10px] border-[1.5px] border-ink bg-surface px-5 py-[18px]">
          {keys.map((k) => {
            const unknown = unknowns.includes(k);
            const fallback = UNKNOWN_DEFAULTS[k];
            const issue = issues.find((i) => i.key === k);
            return (
              <div key={k} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label htmlFor={`f-${k}`} className="text-[14px] text-ink">
                    {QUESTIONS[k]}
                  </label>
                  <div
                    className={`flex items-center gap-1.5 rounded-[8px] border bg-paper px-3 focus-within:border-ink ${
                      issue ? 'border-danger' : 'border-line'
                    } ${unknown ? 'opacity-40' : ''}`}
                  >
                    {PREFIX[k] && <span className="text-[15px] text-ink-3">{PREFIX[k]}</span>}
                    <input
                      id={`f-${k}`}
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      disabled={unknown}
                      autoFocus={k === keys[0]}
                      aria-invalid={issue ? true : undefined}
                      aria-describedby={issue ? `err-${k}` : undefined}
                      value={unknown ? '' : (drafts[k] ?? '')}
                      onChange={(e) => {
                        setDrafts((d) => ({ ...d, [k]: e.target.value }));
                        setIssues((prev) => prev.filter((i) => i.key !== k));
                      }}
                      className="w-28 bg-transparent py-2 text-right text-[15px] font-semibold text-ink outline-none"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    />
                    {SUFFIX[k] && <span className="text-[15px] text-ink-3">{SUFFIX[k]}</span>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  {fallback ? (
                    <button
                      type="button"
                      onClick={() => toggleUnknown(k)}
                      className="cursor-pointer text-[12px] font-medium text-accent"
                    >
                      {unknown ? 'Actually, I know this' : "I don't know"}
                    </button>
                  ) : (
                    <span className="text-[12px] text-ink-3">
                      There is no honest default for this one.
                    </span>
                  )}
                  {issue && (
                    <span id={`err-${k}`} role="alert" className="text-[12px] font-medium text-danger">
                      {issue.message}
                    </span>
                  )}
                </div>

                {unknown && fallback && (
                  <p className="text-[12px] leading-[18px] text-ink-2">
                    Using {fallback.because}. It carries a “we guessed this” badge on the model,
                    so anyone reading it knows the number came from us and not from you.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            className="cursor-pointer rounded-[8px] bg-ink px-5 py-[11px] text-[14px] font-semibold text-white"
          >
            Build the model
          </button>
          <button
            type="button"
            onClick={() => {
              setStage({ kind: 'idle' });
              setIssues([]);
            }}
            className="cursor-pointer text-[13px] text-ink-3 hover:text-ink-2"
          >
            Back to the sentence
          </button>
        </div>
      </form>
    );
  }

  const busy = stage.kind === 'parsing';

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-5">
      <p className="text-[11px] font-semibold tracking-[1.1px] text-ink-3">STEP 1</p>
      <h1 className="text-[38px] leading-[46px] font-semibold tracking-[-0.76px] text-balance text-ink">
        Describe your business in one sentence.
      </h1>
      <p className="max-w-[640px] text-[16px] leading-[26px] text-ink-2">
        Rough numbers are fine. You get a model you can argue with, not an answer you have to
        trust.
      </p>

      <div className="flex flex-col gap-4 rounded-[10px] border-[1.5px] border-ink bg-surface px-5 py-[18px]">
        <textarea
          value={sentence}
          onChange={(e) => setSentence(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit(e);
          }}
          rows={2}
          disabled={busy}
          // Capped at exactly what the URL can carry, so a sentence is never silently
          // shortened after the fact. Typing stops where storage stops.
          maxLength={SENTENCE_MAX}
          placeholder="18k in the bank, 9.5k a month burn, 12 customers paying 400, about 8% churn, 2 new customers a month"
          className="w-full resize-none bg-transparent text-[17px] leading-[28px] text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
        />
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-ink-3">
            {sentence.length > SENTENCE_MAX * 0.8
              ? `${SENTENCE_MAX - sentence.length} characters left`
              : 'No account needed'}
          </span>
          <button
            type="submit"
            disabled={busy || sentence.trim().length < 8}
            className="cursor-pointer rounded-[8px] bg-ink px-5 py-[11px] text-[14px] font-semibold text-white disabled:opacity-40"
          >
            {busy ? 'Reading…' : 'Build the model'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium text-ink-3">Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.chip}
            type="button"
            disabled={busy}
            onClick={() => setSentence(ex.sentence)}
            className="cursor-pointer rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-2 hover:border-ink-3 disabled:opacity-60"
          >
            {ex.chip}
          </button>
        ))}
      </div>
    </form>
  );
}
