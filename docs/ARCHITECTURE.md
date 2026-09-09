# Prime Radiant — architecture review

Reviewed at v0 feature-complete, pre-deploy. 2,552 lines of source.
The system is small enough that most of this document is about two things: the one place
money can leak, and the several places the *measurement* can lie to you.

## 1. Requirements

### Functional
Sentence in → six numbers → 24-month deterministic projection → live sliders → a URL that
fully encodes the model → anyone can open it and fork it.

### Non-functional, in priority order
| Requirement | Target | Why it ranks here |
|---|---|---|
| Recompute latency | < 16ms/frame | The product IS the drag. Stated as a stop-work criterion in SPEC 9. |
| Cost per viewer | ~0 | Distribution is viral; if viewers cost money, virality is a liability. |
| Measurement fidelity | Must not bias the fork rate | The entire project is one experiment. A biased number is worse than no number. |
| Availability | Best effort | It is a two-week validation, not infrastructure. |
| Time to market | 10 days | Hard cap. Bounded downside is the point. |

**Measurement fidelity is a non-functional requirement here, and an unusually load-bearing
one.** Everything gets judged against a 5%/15% threshold. A systematic bias of a few points
flips the decision. It deserves the same rigour normally reserved for correctness.

### Constraints
Team of one. No accounts, no database — a deliberate constraint, not a limitation, because it
is what makes the fork mechanic frictionless.

## 2. High-level design

```
                      ┌──────────────── the URL is the database ────────────────┐
                      │   /m?d=base64url({v,s,p,a,o?,f?})   ~674–1100 chars      │
                      └─────────────────────────────────────────────────────────┘
                                            │
   ┌────────────┐   sentence    ┌───────────▼──────────┐
   │  Composer  │──────────────▶│  /api/parse          │   ← the ONLY paid call
   │  (client)  │◀──────────────│  Haiku 4.5 + Zod     │      $0.00095 each
   └────────────┘  six numbers  │  structured outputs  │
         │         or `missing` └──────────────────────┘
         │
         │ router.push
         ▼
   ┌──────────────────────────────────────────────────────────┐
   │  /m   (client component, reads ?d= once, then owns state) │
   │                                                           │
   │   params ──▶ lib/engine.ts ──▶ {points, derived}          │
   │      ▲        pure, 0 imports        │                    │
   │      │                               ├──▶ Verdict         │
   │   SliderPanel ◀── sync onInput ──────┼──▶ Chart (SVG)     │
   │                                      └──▶ Assumptions     │
   │                                                           │
   │   params ──(debounced 300ms)──▶ history.replaceState       │
   └──────────────────────────────────────────────────────────┘
                          │
                          └──▶ PostHog: model_created, link_opened,
                                        slider_moved, fork_saved
```

**The load-bearing decision is that `lib/engine.ts` has no imports.** It is the reason
recompute is 1–3ms, the reason the tests are trivial, and — see §4 — the reason the fix for
the biggest problem below costs almost nothing.

### Cost model
Cost scales with **creators**, not **viewers**. One parse per model created; unlimited opens
and forks after that are static assets and client arithmetic. 1,000 models with 50 opens each
is $0.95 of API spend against 50,000 page views. This is the right shape for something whose
distribution plan is virality, and it happened on purpose.

## 3. Findings

Ranked by expected damage, not by how hard they are to fix.

### A. Every shared link is invisible to the thing sharing it — *critical*

`/m` is a client component reading `useSearchParams`, so Next prerenders it as **static**. The
shipped artifact is a 7.2KB shell:

```
$ grep -c "die before you get there\|Cash balance" .next/server/app/m.html
0
<title>Prime Radiant — a runway model you can argue with</title>   ← identical for every link
```

No `og:` tags anywhere in the app. So on X, Slack, iMessage, Discord, LinkedIn — every unfurler
sees the same generic card, with no verdict, no numbers, no curve.

The product thesis is *"the artifact produced by using it is the artifact worth sharing."*
Right now the artifact does not survive being shared. "You die before you get there" — the
screenshot-able claim the four outcome classes exist to produce — is the one thing a potential
forker cannot see before deciding whether to click.

This attacks the kill metric from the worst direction: it suppresses `link_opened` itself, so
a low fork rate would be indistinguishable from a product nobody wants.

**Fix, and it is cheap because the engine is pure:** the server can decode `?d=`, run
`model()`, and produce the headline with zero I/O and no database.
- `generateMetadata({ searchParams })` in `app/m/page.tsx` → per-link `<title>` and
  `og:title` / `og:description` carrying the verdict and the numbers.
- An `/api/og` route rendering headline + curve, referenced from `openGraph.images`.
  (The `opengraph-image` file convention only receives `params`, never `searchParams`, so a
  query-encoded payload needs the explicit route. Alternatively move to `/m/[d]` — cleaner,
  but changes the URL shape SPEC 5.1 specifies.)

**Trade-off:** reading `searchParams` makes `/m` dynamic, so link opens become function
invocations instead of CDN hits. At validation volumes this is free, the compute is pure
arithmetic with no I/O, and it also removes the blank-shell paint. Worth it.

### B. The kill metric is measured on a biased sample — *high*

`link_opened` fires in a `useEffect`, i.e. only after JS downloads, parses and hydrates.

Fork rate = `slider_moved ÷ link_opened`. Both are client-side, so both exclude the same
populations — people who bounce pre-hydration, and people who block PostHog (a *large*
fraction of a founder/dev audience on X). The ratio is therefore not "fork rate", it is
**"fork rate among people who fully loaded the page and permit analytics"**, which is an
optimistic upper bound on the real thing.

Against thresholds of 5% and 15%, this biases toward the expensive error: continuing to build.

**Recommendation:** keep both events client-side — mixing a server-side denominator with a
client-side numerator would bias the other way and is worse. Instead, once `/m` is dynamic for
(A), record a server-side raw open count as a *separate* series. You are not trying to correct
the ratio; you are trying to know how big the untracked population is, so you know the error
bar on the number you are about to bet the project on. Write the interpretation down before
you see the data.

### C. `model_created` is double-counted — *high, one line*

```
components/Composer.tsx:86   track('model_created')          ← fires, then router.push
components/ModelClient.tsx:79  else track('model_created', …)  ← fires again on mount (new=1)
```

Every model created counts twice. `model_created` is the top of the funnel, so every
conversion rate computed from it is halved. Drop the Composer one — ModelClient's has the
fingerprint attached.

### D. `fork_saved` double-fires — *medium*

`onCopy` and `onShare` both capture it, so copying the link and then posting counts two forks
from one person. Dedupe per session with the existing `trackOnce`.

### E. The rate limiter does not survive serverless — *medium*

`buckets` is a module-level `Map`. Vercel runs many instances and recycles them, so the real
limit is *20/hour × concurrent instances*, reset by every cold start.

Exposure is bounded but not trivial: $0.00095/parse → **$950 per million**. A scraper is the
threat, not a bill from real users.

For a two-week test this is probably acceptable *if you look at the dashboard*. The cheap
mitigations, in order: a hard daily spend cap on the Anthropic key (do this regardless — it
is the only real backstop), then Vercel KV if the test runs longer.

### F. No alerting on the single instrument you are betting on — *medium, operational*

One measurement instrument, no monitoring, and a 14-day window. If the PostHog key is wrong or
events are being blocked at a rate you did not anticipate, you find out on day 14 with nothing
to show for the two weeks.

Check the funnel on day 1 and day 2 with your own traffic, and confirm all four events arrive
with the properties you expect, before you post anything publicly.

## 4. Scale and reliability

Genuinely trivial, and that is the design working:

| Component | Scaling | Failure behaviour |
|---|---|---|
| `/`, `/m` | CDN / stateless functions | — |
| `lib/engine.ts` | Runs on the viewer's CPU | Cannot fail; no I/O |
| `/api/parse` | Stateless | **Degrades correctly** — falls back to manual entry, product still works |
| PostHog | Third party | Product fine, *experiment* silently broken (see F) |
| Vercel | — | Total outage, no mitigation. Fine for v0. |

The Anthropic dependency degrading into a working product instead of an error page is the best
reliability property in the system, and it was a deliberate choice (SPEC 4.4).

**Payload ceiling:** 674 chars today with no LLM assumptions; ~1,100 with four assumption
sentences plus a fork's origin params. SPEC 5.1 says switch to short codes at ~1,500. There is
less headroom than it looks — a verbose parse plus a fork-of-a-fork is the case to watch.

## 5. What I would revisit, and when

| Trigger | Change |
|---|---|
| Payload > 1,500 chars | Short-code service + KV. Breaks the "no database" property — that is the real cost, not the work. |
| Test runs > 2 weeks | Move rate limiting to KV. |
| Second vertical | `engine.ts` becomes one implementation behind an interface. Do not generalise before then. |
| Phase 2 (predictions/calibration) | Needs real persistence and identity. This is the decision that ends the no-accounts architecture, so take it deliberately rather than arriving at it. |

## 6. Assumptions made in this review

- USD only, 24-month horizon (the Figma file says 12 — unresolved).
- Deploy target is Vercel with default settings.
- "Shared link" traffic arrives predominantly from X.
- No API key has been exercised yet, so the parse success path is unverified in practice.
