# Prime Radiant

Type one sentence about your business, get a runnable cash model with sliders and a shareable
link anyone can fork.

Codename only. Do not put "Prime Radiant" on a domain.

## Run it

```bash
pnpm install
cp .env.example .env.local   # optional — see below
pnpm dev
```

The app works with **no environment variables at all**. Without `ANTHROPIC_API_KEY`, `/api/parse`
returns `no_key` and the composer falls back to six manual number fields; everything downstream —
the model, the chart, the sliders, the sharing, the forking — is identical, because none of it
touches the API.

| Variable | Effect when unset |
|---|---|
| `ANTHROPIC_API_KEY` | Sentence parsing is off; manual entry instead. |
| `NEXT_PUBLIC_POSTHOG_KEY` | Analytics no-ops entirely. |

## What's where

```
lib/engine.ts       the whole predictive core. Pure, zero imports, 100% of the arithmetic.
lib/engine.test.ts  the tests that matter. If this is wrong, nothing else does.
lib/url.ts          the database (it's the URL)
lib/schema.ts       Zod, on everything crossing a trust boundary
app/api/parse       sentence -> six numbers. The only cost surface.
components/Chart    hand-rolled SVG, ~250 lines, no chart library
```

Read `CLAUDE.md` before changing anything — it lists the eight invariants that make this
product work. `docs/SPEC.md` is the full product spec, including what is deliberately *not*
being built and the metric this is being judged on.

## The maths

```
customers = customers * (1 - churn) + newPerMonth
revenue   = customers * price
cash      = cash + revenue - burn
```

Run 24 times. That's it. Claude reads your sentence and never computes a number.
