@AGENTS.md

# Prime Radiant

Type one sentence about your business, get a runnable cash model with sliders and a
shareable link anyone can fork. Codename only — do not put "Prime Radiant" on a domain.

Full product spec lives in `docs/SPEC.md`. This file is the operating manual.

## Commands

```bash
pnpm dev          # next dev (turbopack)
pnpm test         # vitest run. Offline only: never calls the API, safe in CI.
pnpm test:watch
pnpm eval:parse   # the live extraction eval. Needs ANTHROPIC_API_KEY. ~13 Haiku calls,
                  # well under a cent. Skipped by `pnpm test` so it never runs by accident.
pnpm build        # must pass before any deploy
pnpm lint
```

## The one rule for scope

**If a feature does not increase the chance that a link-opener forks, it does not go in v0.**

Out of scope, deliberately: accounts, auth, any database, predictions/resolution/calibration,
Monte Carlo or uncertainty bands, verticals beyond SaaS runway, mobile drag, saved model
libraries. All of these are documented in the spec as deferred. Do not "just add" them.

## Architecture

```
app/page.tsx            empty state, one page
app/m/page.tsx          the model. Dynamic, not static: generateMetadata reads ?d= so every
                        shared link unfurls with its own verdict.
app/api/parse/route.ts  sentence -> params. The only paid call.
app/api/og/route.tsx    the preview card. Engine-derived text only.
lib/share.ts            what a link preview is allowed to say
lib/parse.ts            prompt, extraction schema, salvage and normalisation. No network.
lib/extract.ts          the one call that costs money. Route and eval share it, so the
                        eval exercises the production path rather than a copy.
lib/parse-cases.ts      the adversarial extraction set, plus its grader
lib/engine.ts           project(), derive(). Pure. Zero imports. The predictive core.
lib/schema.ts           Zod. Validates everything crossing a trust boundary.
lib/url.ts              canonical encode/decode of ModelState. See docs/URL-CONTRACT.md.
components/Chart.tsx    hand-rolled SVG
components/*            SliderPanel, Assumptions, Verdict
```

### Invariants — break these and the product stops working

1. **`lib/engine.ts` has no imports.** No React, no formatting, no rounding, no deps.
   Money is rounded for display only, never inside the loop. Test it in isolation.
2. **The AI never computes anything.** Claude Haiku is a *parser*: sentence in, six numbers
   out. Every number on screen comes from `engine.ts` arithmetic you can read in 20 lines.
3. **The parser is checked, not trusted.** `normalizeParseResult` only catches a field the
   model *admits* it could not ground; it cannot tell a confidently-wrong number from a right
   one, and since the OG work that number lands on a card carrying our domain.
   `lib/parse-cases.ts` is the check: growth rates not converted to counts, retention not read
   as churn, annual prices divided, injected instructions ignored. Add a case whenever you
   change the prompt.
4. **Never invent a number, and never quietly change one.** If a field is not grounded in
   the user's sentence it goes in `missing[]` and the UI asks. A defensible default goes in
   `inferred[]`, travels in the URL as `i`, and renders a "we guessed this" badge — if that
   chain breaks anywhere the badge silently disappears, which is how it shipped broken once.
   Out-of-bounds input is **rejected with a per-field message** by `validateParams`, never
   clamped: a form showing 100% churn while the chart draws 99% is the same lie as inventing
   a number. `lib/engine.ts` owns `BOUNDS`; Zod refines against it rather than restating it.
5. **Recompute is synchronous on every `input` event.** Not debounced, not deferred, not in
   a transition. 24 iterations of six-op arithmetic is nothing. The curve must move while
   the finger is down. Only the *URL rewrite* is debounced (300ms).
6. **The URL is the database, and posted links are an API.** All state round-trips through
   `?d=`. If something cannot be encoded in the URL, it is not state — it is a v0 scope
   violation. The v1 wire contract is frozen once a link is public: read
   `docs/URL-CONTRACT.md` before touching `lib/schema.ts`, the bounds in `lib/engine.ts`, or
   `encodeState`. Tightening a bound is a breaking change, because it turns live links into
   broken-link pages. `lib/contract.test.ts` holds a frozen golden payload; if it fails you
   have broken every link ever shared, and updating the literal is not the fix.
7. **Cash is allowed to go negative and stays plotted.** Never clamp the y-domain at zero.
   Going negative is the entire point of the chart.
8. **Churn is applied to the existing base before new customers are added**, so a customer
   acquired this month cannot churn this month. This is a modeling choice, not a fact, and
   it materially shifts the curve. It must stay visible in the assumptions list.
9. **Preview cards carry engine output only.** `shareCard` takes `Params`, never
   `ModelState`, so the sentence and assumption strings written by whoever crafted the link
   cannot reach an unfurl on our domain. Keep that signature: it is what makes the guarantee
   structural instead of a thing someone has to remember.
10. **Opening a shared link is read-write immediately.** No view mode, no gate, no modal
   before the first slider move. Every gate costs fork rate, which is the only number
   being measured.

### The four outcome classes

`derive()` returns `outcome`, and `Verdict.tsx` picks the headline from it:

| outcome | condition | headline |
|---|---|---|
| `never_runs_out` | viable, no runout | "You never run out." |
| `dies_before_arrival` | **viable, but runs out first** | **"You die before you get there."** |
| `structural_runout` | not viable, runs out | "You run out in month N and never recover." |
| `plateau_below_burn` | not viable, survives 24mo | "Revenue plateaus below burn." |

`dies_before_arrival` is the reason this product exists. It is the claim worth screenshotting.
Lead with it whenever it fires. If every headline reads bland, the product has no distribution.

## Design

The UI is built from the Figma file *Prime Radiant v0 — Runway Simulator*
(`8lkMqKp1o18V9CSA82BKmq`), frames `1:3` (empty state), `1:10` (model), `1:17` (fork).

That file defines **no Figma variables**, so its raw hex values are named once in the `:root`
block of `app/globals.css` and mapped into Tailwind through `@theme inline`. Nothing else in
the codebase hardcodes a colour — re-matching a design change is a swap in that one block.

Type is Inter throughout. Cards are 12px radius, controls 8px. The model row is a fixed
776px chart card beside a flexible panel inside a 1280px container with 40px gutters, which
is exactly the Figma geometry.

Deliberate deviations from the file, each with a reason:

| Deviation | Why |
|---|---|
| Slider panel stays on the shared/fork screen; the diff panel stacks under it | The file replaces the sliders with the diff panel, which would make a shared link read-only. That breaks SPEC 5.2 and removes the only action the kill metric counts. |
| Attribution strip shows no opens/forks counts | Counting needs a database. v0 has none. |
| "Customers today" is a number field in the slider panel | The file has five sliders and no sixth control, but a fork has to be able to disagree with the customer count. |
| Assumption lines are generated from live params, not the parser's prose | The file shows the parser's four sentences. They go stale the moment a slider moves, and stale claims beside a live chart is the top-severity risk in SPEC 11. The parser's reading sits in the echo strip instead, where it describes the sentence rather than the model. |
| No stat strip for ceiling/breakeven | The file has none, and the verdict body already states every closed-form fact in prose. |
| Empty state has a "where the numbers come from" section below the fold | Answers the "just another AI wrapper" risk. The first screen still matches the file exactly. |

**Open discrepancy:** the file's chart axis is **12 months** ("12 months projected", ticks at
month 3/6/9/12) but SPEC 2 and the `plateau_below_burn` outcome say **24**. The code follows
the spec. Axis ticks derive from the horizon, so switching is one constant: `DEFAULT_MONTHS`
in `lib/engine.ts`.

## Conventions

- Param field names match the LLM wire format exactly (`startingCash`, `monthlyBurn`,
  `customers`, `price`, `churn`, `newPerMonth`). One naming scheme, no mapping layer.
- Currency is USD for v0. `currency` stays in `ModelState` for a later swap; do not build
  a second formatting path.
- Slider domains are **fixed**, not relative to the parsed value, so URLs stay stable and
  forks are comparable. A parsed value above a max expands that slider to `2 x value` for
  the session rather than clamping the input.
- Chart is hand-rolled SVG. Do not add Recharts or any chart library. Annotation positions
  are computed from curve geometry, never from fixed coordinates.
- Verdict headline is the largest element on the page. Not the chart.
- Assumptions are always visible next to the chart. Never collapsed behind a disclosure.

## The kill metric

Fork rate = `slider_moved` / `link_opened`, among sessions that arrived via a shared link.
Events: `model_created`, `link_opened`, `slider_moved` (first move per session), `fork_saved`.
Above 15% build phase 2. 5-15% rewrite the framing once. Under 5% kill it.
Analytics is a thin adapter in `lib/analytics.ts` and no-ops without a PostHog key.
