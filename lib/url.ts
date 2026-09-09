/**
 * The URL is the database. Everything here must round-trip losslessly and never throw:
 * a malformed `?d=` is a stranger's mangled link, not an exception, and SPEC 4.4 says
 * never show an error page.
 */
import { ModelStateSchema, PAYLOAD_BUDGET, type ModelState } from './schema';
import { PARAM_KEYS, type Params } from './engine';

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return typeof btoa === 'function'
    ? btoa(bin)
    : Buffer.from(bytes).toString('base64');
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * Canonical serialisation: the same model must always produce byte-identical output.
 *
 * `JSON.stringify` follows insertion order, so two paths that build the same state in a
 * different order used to yield different URLs for the same model. That is not cosmetic any
 * more. `/api/og` ships immutable cache headers keyed on the payload, so an equivalent-but-
 * different string is a cache miss and a duplicate render, and analytics would see one model
 * as two.
 */
function canonicalParams(p: Params): Record<string, number> {
  const out: Record<string, number> = {};
  // Always the engine's key order, never the order the object happened to be built in.
  for (const key of PARAM_KEYS) out[key] = p[key] === 0 ? 0 : p[key];
  return out;
}

function canonicalState(state: ModelState): Record<string, unknown> {
  const out: Record<string, unknown> = {
    v: state.v,
    s: state.s,
    p: canonicalParams(state.p),
    a: state.a,
  };
  // Which fields were guessed is a set, not a sequence, so order it and drop duplicates.
  if (state.i && state.i.length > 0) out.i = PARAM_KEYS.filter((k) => state.i!.includes(k));
  if (state.o) out.o = canonicalParams(state.o);
  if (state.f) out.f = state.f;
  return out;
}

export function encodeState(state: ModelState): string {
  const json = JSON.stringify(canonicalState(state));
  return bytesToBase64(new TextEncoder().encode(json))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Returns null on anything unparseable. Callers fall back to the empty state. */
export function decodeState(d: string | null | undefined): ModelState | null {
  if (!d) return null;
  // Enforced at the trust boundary, before any parsing work. The schema caps make an
  // over-budget payload unreachable through the app, but `?d=` is hand-editable and
  // /api/og renders on every crawl, so a megabyte of base64 must be refused up front
  // rather than decoded, JSON-parsed and Zod-walked first.
  if (d.length > PAYLOAD_BUDGET) return null;
  try {
    const b64 = d.replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(base64ToBytes(b64));
    const parsed = ModelStateSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function stateToPath(state: ModelState): string {
  return `/m?d=${encodeState(state)}`;
}

/**
 * Stable 8-char id for a set of params. Not cryptographic — it exists so analytics can say
 * "these nine forks descend from one model", which is the only thing a fork family needs.
 */
export function fingerprint(p: Params): string {
  const s = JSON.stringify([
    p.startingCash,
    p.monthlyBurn,
    p.customers,
    p.price,
    p.churn,
    p.newPerMonth,
  ]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(7, '0').slice(0, 8);
}

/** Which of the six numbers a fork has actually changed. Drives the diff panel. */
export function changedParams(origin: Params, current: Params): (keyof Params)[] {
  return (Object.keys(current) as (keyof Params)[]).filter(
    (k) => origin[k] !== current[k],
  );
}
