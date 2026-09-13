# Measurement plan

**Status: pre-registered. Written before any data existed, and before the app was deployed.**

That is the entire point. Every rule below — what counts, what is thrown away, how many
observations are needed, and what each outcome triggers — is fixed in advance, because the
failure mode this document exists to prevent is looking at a disappointing number and
discovering a reason it does not count.

If you change anything here after data starts arriving, bump `MEASUREMENT_RUN` in
`lib/analytics.ts` and start a fresh sample. Do not pool across runs.

## The metric, named honestly

```
interaction rate = slider_moved ÷ link_opened
                   (both scoped to the same tab and the same model)
```

SPEC 10 calls this "fork rate". It is not one. `slider_moved` fires on the first drag of a
model in a tab; it does not establish that anyone copied a link, posted it, or even kept the
change. The honest name is **interaction rate**, and it answers one question: *did being sent
this artifact provoke a reaction?*

`fork_saved` is the weaker-volume but truer signal — it fires only when a modified link is
copied or posted. Record both. The decision rule below runs on interaction rate because that
is what the thresholds were set against; `fork_saved` is reported alongside and is what you
should believe if the two disagree sharply.

### Unit of analysis

One browser tab, one model, identified by the model's parameter fingerprint. Both the
numerator and the denominator are claimed at most once per tab per model via sessionStorage,
so a reload cannot inflate either. This is enforced in code by `trackSessionOnce`.

## Source attribution

A session qualifies for the denominator only if it is an **inbound** open: the tab did not
author that model. Authorship is recorded in sessionStorage when the composer creates a
model, and claimed again when a fork diverges. It is deliberately not in the URL — a query
flag was erased by the app's own debounced rewrite, which used to reclassify the author as a
stranger on every reload.

Consequences, both intended:

- Opening your own model, reloading it, and re-sharing it never enters the denominator.
- Forking a link somebody sent you and then reloading counts the **original** as one inbound
  open and the fork as your own creation, not a second open.

## Exclusions, decided now

Discard from both numerator and denominator:

1. **Sessions from your own devices.** Before posting anything, open the deployed app once
   and set the PostHog opt-out for your own browsers, or filter your `distinct_id` out.
   Decide which before launch; do not decide it after seeing the number.
2. **Any `$browser` PostHog classifies as a bot**, plus sessions whose `$raw_user_agent`
   matches `bot|crawl|spider|preview|scan|headless|lighthouse|slurp`.
3. **Sessions with zero `$pageview` duration** and no subsequent event — a fetch, not a read.
4. **Anything during a deploy window.** Note the timestamp of every deploy; discard the
   surrounding five minutes rather than arguing about it later.
5. **Any run where `MEASUREMENT_RUN` differs.** Never pool.

Do **not** exclude: mobile sessions, sessions that bounce fast, sessions from a single
referrer, or "people who obviously did not understand it". Those are the result.

### Bot contamination is structurally low, but not zero

Events fire from client JavaScript, so crawlers that do not execute JS never enter the
funnel at all. `/m` is server-rendered for unfurlers, and `/api/og` serves the preview image,
so the crawl traffic that matters lands on paths that emit no analytics. The filters above
cover the minority of crawlers that do run JS.

### Forged events are possible

`NEXT_PUBLIC_POSTHOG_KEY` is public by construction, so anyone can post arbitrary events into
this project. There is no fix for that without a server-side ingest this product deliberately
does not have. Mitigation is detection, not prevention: before reading the result, check for
implausible bursts from one `distinct_id`, and for `slider_moved` without a preceding
`link_opened` in the same session. If the sample looks tampered with, discard the run.

## Minimum sample size

**Hard floor: 100 qualifying inbound opens. Target: 200.**

Below 100 the answer is "not enough data, keep distributing" — not a number, and not a
decision. This is not a round figure, it is where the 95% Wilson interval first separates the
two thresholds:

| n | if you observe 5% | if you observe 10% | if you observe 15% |
|---|---|---|---|
| 25 | 0.7% – 19.5% | 4.2% – 30.0% | 6.4% – 34.7% |
| 50 | 2.1% – **16.2%** | 4.3% – 21.4% | 8.3% – 28.5% |
| **100** | 2.2% – 11.2% | 5.5% – 17.4% | 9.3% – 23.3% |
| 200 | 2.7% – 9.0% | 6.6% – 14.9% | 10.7% – 20.6% |
| 400 | 3.3% – 7.6% | 7.4% – 13.3% | 11.8% – 18.8% |

At n=50, an observed 5% still reaches 16.2% — it cannot be told apart from a result that says
*build phase 2*. At n=100 both thresholds separate. Distinguishing 8% from 13% *within* the
middle band needs n≈400, which the decision rule does not require.

## The decision rule

Read once, at the end of the window, on the qualifying sample:

| Interaction rate | Action |
|---|---|
| Lower bound above 15% | The artifact is legible. Build the phase 2 retention layer. |
| Interval spans 5–15% | Framing problem, not a product problem. One rewrite of the input experience and headline copy. One more run. Not two. |
| Upper bound below 5% | Kill it. Build the calibration trainer instead. |
| Interval spans a threshold | Inconclusive. Extend the window or get more traffic. Do not round toward the answer you want. |

Judge on the **interval**, not the point estimate. A point estimate of 14.8% at n=100 is not
"nearly 15%", it is 9.3%–23.3%.

## Known biases, and which way they push

Stated in advance so they cannot be discovered conveniently later.

| Bias | Direction | Status |
|---|---|---|
| Ad blockers and tracker blocking drop both events | Shrinks sample; ratio roughly preserved | Accepted. The sample is "people who permit analytics", and that skews technical. |
| Pre-hydration bounces enter neither count | Inflates the rate | Accepted and unfixable client-side. |
| `slider_moved` counts a drag, not a fork | Inflates relative to actual sharing | Mitigated by reporting `fork_saved` alongside. |
| Mobile ergonomics | Was a large suppressor | Fixed before launch (T10). Do not run this on a build without it. |
| Missing link previews | Suppressed `link_opened` at source | Fixed before launch (T9). Do not run this on a build without it. |

## What invalidates a run

Stop, fix, and restart with a bumped `MEASUREMENT_RUN`:

- A deploy that changes the composer, the model page, the slider panel, or the analytics.
- Discovering that an event fires more or less than once per tab per model.
- Any evidence of forged events.
- Fewer than 100 qualifying opens at the end of the window.

## Distribution and the window — decided 2026-09-13

The last two open fields (SPEC 13.2, TODOS D1 and D2). Recorded before any data exists, which
is the only time they can be set honestly.

### The split, and why there is one

TODOS D1 asked one question — "where does the first post go" — that turned out to be two.
*Where the first post goes* and *where the measurement run happens* are the same event only if
you already have an audience. Starting cold they cannot be, and it is not close.

The denominator is filled **exclusively** by strangers opening a `/m?d=` link somebody else
authored. `ModelClient.tsx` fires `model_created` when the tab authored the model and
`link_opened` only when it did not, so visitors who arrive at `/` and build their own model
never enter the denominator, however many of them there are. **A post that sends people to the
homepage measures nothing.** A post must carry a model link.

Working back from the floor, with no audience:

| Step | Estimate |
|---|---|
| Impressions, cold X link post | a few hundred at best |
| Clicks at 1–3% | 3–20 |
| Qualifying, after blocking and pre-hydration bounce (≈ ×0.6) | **under 15** |
| Floor required | **100** |

The multipliers are estimates, not measurements. The gap is 10×, so the conclusion survives
any defensible correction to them. The fork loop does not close it either: it is a
*tail-sampling* mechanism — it pays when an opener who already has reach forks and reposts —
and from a seed of ten opens that tail is essentially never sampled. It multiplies traffic; it
cannot create it.

So the first post ships as a **pilot**, and the kill-metric run stays unspent.

### D1a. The pilot — decided

**Channel:** X, one post carrying a model link (not the homepage), authored by us.
**Run id:** `2026-09-13-pilot` in `lib/analytics.ts`.

**What it is for** — proving the instrument, which ARCHITECTURE §3F asks for and DEPLOY's
day-one section already half-specifies:

- events arrive in PostHog at all, carrying `run`
- `link_opened` fires for a stranger and does not fire for us
- `$current_url` shows `d=redacted`
- the unfurl carries the verdict headline, not the generic card
- somebody who is not us moves a slider at least once

**What it is not for:** the kill decision. No interaction rate computed on pilot data enters
the decision rule above, at any n. Pilot events carry a `-pilot` run id so they cannot be
pooled with the real run even by accident.

### D1b. The measurement channel — still open, and now gated

**Gate:** the run does not start until a channel exists that can plausibly deliver ~170
stranger clicks on model links, which is what n=100 costs at the multipliers above.

| Route | What it preserves | What it costs |
|---|---|---|
| Borrow reach — someone with an audience posts a model | Sample stays cold, so 5%/15% stay valid as derived | Depends on an ask landing; not under our control |
| Seeded outreach — personalised models sent directly | Fully under our control; highest response rate | ~300–500 sends for n=100, **and the thresholds stop being valid** |
| Build an audience first | Everything | Weeks to months |

**If seeding becomes the channel, the thresholds must be re-derived before any data arrives.**
5% and 15% were set against cold strangers. Somebody sent a model of their own business forks
at a much higher rate, so clearing 15% on a seeded sample would trigger "build phase 2" on a
sample that was never comparable. Re-deriving *after* seeing the number is the exact failure
this document exists to prevent.

Do not pool routes. If more than one is used, segment by channel and report separately.

### D2. The window — decided

**Run until 100 qualifying inbound opens, hard cap 14 days. The clock starts at the first
public post of the measurement run** — not at deploy, and not at the pilot.

- **n-gated rather than fixed length,** because the floor is what makes the interval readable.
  A fixed window ending at n=60 produces nothing this document can interpret.
- **Capped at 14 days,** because the cap is not arbitrary: TODOS T-A and ARCHITECTURE §5 both
  say a run longer than two weeks means moving rate limiting to Vercel KV. Fourteen days is the
  boundary that lets T-A stay accepted debt instead of silently becoming work.
- **Clock starts at the first public post,** because DEPLOY's day-one checks and ARCHITECTURE
  §3F both require verifying the funnel on our own traffic first, and this document already
  discards five minutes around every deploy. Starting at deploy spends window on our own
  verification traffic.

**If the cap is reached below n=100, the answer is already written: "not enough data, keep
distributing."** That is not a disappointing result to be reinterpreted — it is the
pre-registered outcome, and the decision rule is not consulted.

### Own-device exclusion — decided

Exclusion 1 above offered a choice between opting our own browsers out of PostHog and
filtering our `distinct_id` afterwards. **Do both.** They fail in different ways: an opt-out is
per browser and dies when storage is cleared or another device is used; a `distinct_id` filter
depends on having noted the id before the run. Belt and braces costs nothing, and the failure
guarded against is our own traffic sitting in the denominator of a 100-open sample, where a
dozen sessions move the point estimate by several points.
