import { ImageResponse } from 'next/og';
import { DEFAULT_MONTHS, project, type Point } from '@/lib/engine';
import { shareCard } from '@/lib/share';
import { decodeState } from '@/lib/url';

/**
 * The preview card for a shared model.
 *
 * This exists because `/m` reads its state from the query string, and Next's
 * `opengraph-image` file convention only ever receives route `params`, never `searchParams`.
 * A query-encoded payload therefore needs an explicit route.
 *
 * Everything drawn here comes from `shareCard`, which is handed only the six numbers. None
 * of the link author's prose can reach this image.
 */
export const runtime = 'nodejs';

const W = 1200;
const H = 630;
const PLOT_W = 1056;
const PLOT_H = 170;

const PAPER = '#fafaf8';
const INK = '#14140f';
const INK_2 = '#54544c';
/** Separator glyphs only, matching --ink-faint. Never text that carries meaning. */
const INK_FAINT = '#a3a39c';
const ACCENT = '#0f6b5c';
const DANGER = '#c2410c';

type Vertex = { x: number; y: number; cash: number };

const toPath = (pts: { x: number; y: number }[]) =>
  pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/**
 * Same shape as the in-app chart, minus the annotations a 1200x630 card has no room for.
 *
 * The curve is split at the zero crossing so solvent months are teal and underwater months
 * are orange, exactly as in the app. Satori only supports a subset of CSS and no clip-path,
 * so the split is done in geometry: each segment that straddles zero is cut at the
 * interpolated crossing, which lands exactly on the zero line because y is linear in cash.
 */
function curve(points: Point[], w: number, h: number) {
  let lo = 0;
  let hi = 0;
  for (const p of points) {
    if (p.cash < lo) lo = p.cash;
    if (p.cash > hi) hi = p.cash;
  }
  if (lo === hi) hi = lo + 1;

  const x = (m: number) => (m / (points.length - 1)) * w;
  const y = (cash: number) => h - ((cash - lo) / (hi - lo)) * h;

  const vertices: Vertex[] = points.map((p) => ({ x: x(p.month), y: y(p.cash), cash: p.cash }));
  const above: string[] = [];
  const below: string[] = [];

  let run: { x: number; y: number }[] = [vertices[0]];
  let runIsAbove = vertices[0].cash >= 0;

  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1];
    const b = vertices[i];
    if (a.cash >= 0 === b.cash >= 0) {
      run.push(b);
      continue;
    }
    const t = a.cash / (a.cash - b.cash);
    const crossing = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    run.push(crossing);
    (runIsAbove ? above : below).push(toPath(run));
    run = [crossing, b];
    runIsAbove = b.cash >= 0;
  }
  (runIsAbove ? above : below).push(toPath(run));

  return { above, below, zeroY: y(0), crossesZero: lo < 0 && hi > 0 };
}

export async function GET(req: Request) {
  const state = decodeState(new URL(req.url).searchParams.get('d'));

  // A mangled payload still gets a card. A broken unfurl is worse than a plain one, and it
  // would show up in exactly the channel this product depends on.
  const card = state
    ? shareCard(state.p, DEFAULT_MONTHS)
    : {
        headline: 'A runway model you can argue with.',
        facts: ['One sentence in', 'Every assumption on the page', 'Fork it and disagree'],
        description: '',
        tone: 'good' as const,
      };

  const path = state ? curve(project(state.p, DEFAULT_MONTHS), PLOT_W, PLOT_H) : null;

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: '100%',
          height: '100%',
          background: PAPER,
          padding: '56px 72px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', fontSize: 22, fontWeight: 600, letterSpacing: 2, color: INK }}>
          PRIME RADIANT
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: card.headline.length > 42 ? 62 : 74,
              fontWeight: 600,
              letterSpacing: -1.5,
              lineHeight: 1.1,
              color: INK,
            }}
          >
            {card.headline}
          </div>

          {path && (
            <svg width={PLOT_W} height={PLOT_H} style={{ marginTop: 34 }}>
              {path.crossesZero && (
                <line
                  x1={0}
                  y1={path.zeroY}
                  x2={PLOT_W}
                  y2={path.zeroY}
                  stroke={DANGER}
                  strokeWidth={2}
                  strokeDasharray="8 8"
                  opacity={0.7}
                />
              )}
              {path.above.map((d, i) => (
                <path
                  key={`a${i}`}
                  d={d}
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth={5}
                  strokeLinejoin="round"
                />
              ))}
              {path.below.map((d, i) => (
                <path
                  key={`b${i}`}
                  d={d}
                  fill="none"
                  stroke={DANGER}
                  strokeWidth={5}
                  strokeLinejoin="round"
                />
              ))}
            </svg>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', fontSize: 25, color: INK_2 }}>
          {card.facts.map((fact, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
              {i > 0 && <span style={{ color: INK_FAINT, padding: '0 16px' }}>·</span>}
              <span>{fact}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      headers: {
        // The payload fully determines the image, so it can never go stale. Without this,
        // every crawl by every unfurler re-renders at 200-500ms, and a link doing its job
        // becomes the largest compute line in the product.
        'cache-control': 'public, max-age=31536000, immutable',
      },
    },
  );
}
