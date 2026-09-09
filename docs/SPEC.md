# Prime Radiant v0 — Build Spec

**Codename.** "Prime Radiant" is a working title. Asimov-derived, obscure, and meaningless to
a founder scrolling past it. Ship under it, rename before you care about SEO.

**One line.** Type one sentence about your business, get a runnable cash model with sliders
and a shareable link that anyone can fork.

## 1. Why this exists

Every founder holds a mental model of their runway that is linear. Reality is not linear,
because churn compounds against a signup rate and the two interact over time. The gap between
the linear intuition and the actual curve is where people die. The product closes that gap in
under ten seconds, with visible assumptions so the output is arguable rather than authoritative.

**The mechanism that makes it spread and retain at the same time:** the artifact produced by
using it (a live, forkable model) is the artifact worth sharing. No separate "share this"
content is manufactured. Disagreement is the distribution channel, because a model with
visible assumptions has an argument surface, and forking converts a viewer into a user in one
click with no blank page.

## 2. Scope

### In scope for v0
- Single page, single model type (SaaS/subscription runway)
- Natural language sentence to structured parameters
- 24-month projection, deterministic arithmetic
- 5 sliders, live recompute
- Assumptions displayed as editable plain English
- Shareable URL that fully encodes model state
- Fork (open a copy, edit freely, get a new URL)

### Explicitly out of scope

| Deferred | Why |
|---|---|
| Accounts, auth, database | State lives in the URL. Zero infra, zero signup friction, and the fork mechanic works better without accounts. |
| Predictions, resolution dates, calibration | Phase 2. Retention machinery built before traffic is wasted work. |
| Monte Carlo / uncertainty bands | Adds cognitive load before you know anyone cares. |
| Multiple verticals (fitness, savings, hiring) | Generalize only after the mechanism is validated in one place. |
| Mobile-optimized drag | Test on desktop first. Mobile sliders are a separate design problem. |
| Saving, model library, versioning | Requires accounts. |

**Rule:** if a feature does not increase the chance that a link-opener forks, it does not go in v0.

## 3. The engine

Deterministic arithmetic, not AI. The LLM never computes anything.

### 3.1 State variables

| Symbol | Meaning | Unit |
|---|---|---|
| `cash` | Cash in the bank | currency |
| `customers` | Active paying customers | count (fractional allowed) |
| `price` | Revenue per customer per month | currency |
| `churn` | Fraction of customers lost per month | 0 to 1 |
| `newPerMonth` | New customers acquired per month | count |
| `burn` | Fixed monthly cost | currency |

### 3.2 The loop

```ts
for (let m = 1; m <= months; m++) {
  customers = customers * (1 - p.churn) + p.newPerMonth;
  const revenue = customers * p.price;
  cash = cash + revenue - p.monthlyBurn;
  out.push({ month: m, cash, customers, revenue });
}
```

**Ordering assumption (must be surfaced in the UI):** churn is applied to the existing base
*before* new customers are added, so a customer acquired this month cannot churn this month.
This is a modeling choice, not a fact, and it materially shifts the curve. Show it.

### 3.3 Derived facts (the differentiator)

Do not stop at the curve. Compute the closed-form facts, which are exactly the things a
founder cannot do in their head:

```ts
const ceilingCustomers = churn > 0 ? newPerMonth / churn : Infinity;
const ceilingRevenue   = ceilingCustomers * price;
const isViable         = ceilingRevenue > monthlyBurn;
const runoutMonth      = points.find(pt => pt.cash < 0)?.month ?? null;
```

| `isViable` | `runoutMonth` | Headline | Why it matters |
|---|---|---|---|
| true | null | "You never run out." | Fine. Boring. |
| **true** | **not null** | **"You die before you get there."** | **The most valuable output the tool produces.** The business works at steady state but cannot survive the trough. Nobody sees this coming. |
| false | not null | "You run out in month N, and the model does not recover." | Structural problem, not a timing problem. |
| false | null | "You survive 24 months but revenue plateaus below burn." | Slow death past the horizon. |

Row 2 is the reason to build this. Lead with it whenever it fires.

### 3.4 Numerical guards
- `churn` accepted across `[0, 1]`. **Corrected 2026-09-10:** this originally said clamp to
  `[0, 0.99]` "because at exactly 1 the ceiling is undefined". That is wrong. The recurrence
  is `c = c(1 - churn) + n`, whose fixed point at `churn = 1` is exactly `n`, and the closed
  form `n / churn` returns `n`. There is no division by zero. The clamp's only real effect
  was to draw a curve using a number the user did not type, which contradicts the rule below.
- **Out-of-bounds input is rejected and explained, never repaired.** `validateParams` returns
  a per-field issue list; the URL decoder refuses the payload and the forms show the message.
- `churn = 0` gives infinite ceiling. Handle explicitly, do not divide by zero.
- Cash is allowed to go negative and stay plotted. Going negative is the whole point.
- All money rounded for display only, never in the loop.

## 4. The LLM layer

The model's only job is turning a sentence into six numbers. Treat it as a parser, not an oracle.

**Model:** Claude Haiku. ~200 input tokens, ~150 output tokens per call. JSON only, no prose,
no code fences.

```json
{
  "startingCash": 18000, "monthlyBurn": 9500, "customers": 12,
  "price": 400, "churn": 0.08, "newPerMonth": 2,
  "currency": "USD", "missing": [], "inferred": ["churn"],
  "assumptions": ["Churn is a flat 8% each month, applied before new signups land.", "..."]
}
```

### 4.2 The rule that makes this trustworthy

**Never invent a number.** If a required field is not grounded in the sentence, it goes in
`missing`, and the UI asks for it instead of guessing. A field that is a reasonable default
goes in `inferred` and is flagged visually.

This costs a small amount of magic and buys the entire credibility of the product. Every
competitor hides its assumptions because showing them makes the tool look dumb. Showing them
is what makes yours arguable, and arguable is what makes it spread.

### 4.4 Failure handling
- Wrap the fetch in try/catch, strip any fences before `JSON.parse`.
- Validate the parsed object with Zod. Reject on type mismatch.
- On any failure, fall back to a manual-entry form with the six fields empty. Never show an
  error page.
- If `missing.length > 0`, render an inline clarifier with a single number input.

## 5. State and URLs

The URL is the database. `/m?d=<base64url(JSON.stringify(state))>`

```ts
type ModelState = {
  v: 1;        // schema version, for future migrations
  s: string;   // the original sentence, for the echo strip
  p: Params;   // the six numbers + currency
  a: string[]; // assumption sentences
  f?: string;  // parent model id, if this is a fork
};
```

Typical payload is 300-450 characters. Past ~1500, switch to a short-code service — not in v0.

### 5.2 Fork semantics
- Opening a shared link is **read-write immediately**. There is no "view mode."
- The moment a slider moves, the URL rewrites via `history.replaceState` and a "forked from
  original" banner appears.
- Fork is not a button that gates anything. The button says "save and share this version."

**Design reason:** every gate between opening a link and manipulating the model costs fork
rate, which is the only number you are measuring.

## 6. Screens

Three states of one page, not three routes.

**Empty state.** One text box, one sentence, no account. Three example chips (solo consultant,
pre-seed SaaS, ecom store). Copy does the framing: *"a model you can argue with, not an answer
you have to trust."*

**Model state.** Verdict headline is the largest element — not the chart. "You run out of cash
in month 6" is screenshot-able; a cash curve is not. Sentence echo strip at top with Edit
affordance. Chart card (left, ~776px) and slider panel (right, ~400px). Assumptions block full
width below, each line with a "change this" link. Top bar: Copy link (ghost), Share model (solid).

**Shared / fork state.** Attribution strip: opens count, forks count, *"nothing you change here
affects the original."* Original curve as grey dashed, current version as solid teal. Diff panel
showing changed vs unchanged parameters. Bottom strip: *"Think an assumption is wrong? Change it
and post your version."*

## 7. Interaction rules

### 7.1 Slider domains

Fixed domains, not relative to the parsed value, so URLs stay stable and comparisons across
forks are meaningful.

| Slider | Min | Max | Step |
|---|---|---|---|
| Starting cash | 0 | 500,000 | 500 |
| Monthly burn | 0 | 200,000 | 250 |
| Price per customer | 0 | 5,000 | 10 |
| Monthly churn | 0% | 25% | 0.1% |
| New customers / month | 0 | 100 | 1 |

If a parsed value exceeds a max, expand that slider's domain to `2 x value` for that session
rather than clamping the input.

### 7.2 Recompute
- **Synchronous, on every `input` event.** Not debounced. Any perceptible lag kills the product.
- The whole appeal is that the curve moves *while your finger is down*.
- URL rewrite **is** debounced at 300ms, so you do not spam history.

### 7.3 Chart rendering

**Hand-roll the SVG. Do not use Recharts.** Full control over annotation placement (labels
collide with the curve as sliders move), no re-render overhead on drag, roughly 60 lines, one
fewer dependency in a project whose entire value is that it is small.

Annotation collision is the one genuinely fiddly part. Compute label positions from the curve,
not from fixed coordinates.

## 8. Stack

Next.js (App Router) + TypeScript, Tailwind, hand-rolled SVG, Anthropic API (Haiku) in one
route handler, Zod validation, URL-only state, PostHog, Vercel.

`/api/parse` is the only cost surface. Cap `max_tokens` and add an IP token bucket. Cost per
parse is fractions of a cent, so the real risk is a scraper, not a bill.

## 9. Build sequence

**Days 1-3 — the feel.** engine + tests, Chart, SliderPanel wired to local state.
*Success criterion:* you drag a slider and the curve moves with zero perceptible lag. If this
does not feel good, stop and fix it.

**Days 4-6 — the input.** `/api/parse`, empty state, example chips, clarifier, assumptions block.

**Days 7-9 — the loop.** URL encode/decode, copy link, fork banner, diff panel, Verdict with all
four outcome classes, PostHog events.

**Day 10 — ship.** Deploy, post your own model as the first artifact.

**Do not build features on days 11-20. Watch the number.**

## 10. The kill metric

> Of people who open a **shared** link, what percent move a slider and produce a forked URL?

Fork rate = `slider_moved` / `link_opened`, among sessions that arrived via a shared link.

| Result | Action |
|---|---|
| Above 15% | The artifact is legible. Build the phase 2 retention layer. |
| 5 to 15% | Model works, framing does not. One rewrite of input experience and headline copy. One more test. Not two. |
| Under 5% | Kill it. Build the calibration trainer instead. |

Set the measurement date before writing the first line of code. *Confidence on the threshold
itself: moderate. 15% is a judgment call, not a benchmark. What matters more is committing to a
number in advance rather than rationalizing whatever you get.*

## 11. Known failure modes

| Risk | Severity | Mitigation |
|---|---|---|
| Model is confidently wrong, someone screenshots it | High | Assumptions always visible next to the chart, never collapsed. Parser refuses to invent. |
| Vague input produces garbage params | High | `missing` array plus inline clarifier. Never silently default. |
| Annotation labels collide with the curve on drag | Medium | Compute placement from curve geometry. Fiddliest code in the project. |
| Nobody shares because there is nothing to argue with | **Existential** | The four outcome classes exist for this. If your headlines are all bland, the product has no distribution. |
| Reads as yet another AI wrapper | Medium | The AI does parsing only. Say so on the page. The math is four lines and you can show them. |
| Founders find the numbers too exposing to share | Medium | Untested. If shares skew anonymized, lean into "model someone else's business" as the framing. |

## 12. Phase 2, deliberately deferred

Build only if fork rate clears the bar. Documented here so it does not get built early.
Extract a falsifiable prediction with a resolution date; reality grades it on that date; a
calibration record accumulates across models and becomes a non-transferable status object,
which is the retention moat. Worthless without traffic.

## 13. Decisions before day 1

1. **Currency.** — decided: USD.
2. **Distribution.** Where does the first post go, and to whom? The measurement is only
   meaningful if shared links reach people who are not you. Decide before shipping.
3. **Domain.** Anything short. Do not spend more than an hour on it.
4. **Rename.** Do not put "Prime Radiant" on a domain.

## 14. What good looks like at day 10

A stranger opens a link from Twitter, sees "You die before you get there" as a headline, does
not understand it, drags the churn slider, watches the curve flip, and shares their version
with a comment disagreeing with the burn assumption.

That sequence, happening once without your involvement, is the entire validation.
