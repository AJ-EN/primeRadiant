# TODOS

Everything deferred, written down. Vague intentions are lies: if it is not here, it is not
deferred, it is forgotten.

Nothing in this file is work to start now. The scope rule still holds — *if a feature does
not increase the chance that a link-opener forks, it does not go in v0* — and most of what
follows is explicitly gated on the measurement result.

---

## Blocked on a decision, not on code

### D1. Distribution — split, and half-resolved 2026-09-13
Split into two decisions in `docs/MEASUREMENT.md`, because "where the first post goes" and
"where the run happens" are the same event only if you already have an audience.

**D1a, decided:** the first X post ships as a *pilot* that proves the instrument, not as the
measurement run. It must carry a model link, never the homepage — the denominator is filled
only by strangers opening a `/m?d=` link somebody else authored, so a homepage post measures
nothing however much traffic it brings.

**D1b, still open:** the measurement channel itself. **Gate:** the run does not start until a
channel can plausibly deliver ~170 stranger clicks on model links, which is what the 100-open
floor costs. The three routes and their trade-offs are in `docs/MEASUREMENT.md` — note that
choosing seeded outreach invalidates the 5%/15% thresholds and requires re-deriving them
*before* any data arrives.
**Priority:** P1. **Blocks:** the measurement run. No longer blocks shipping.

### D2. Measurement window — decided 2026-09-13
Run to 100 qualifying inbound opens, hard cap 14 days, clock starting at the first public post
of the measurement run (not at deploy, not at the pilot). Written into `docs/MEASUREMENT.md`
with the reasoning.
**Note:** the 14-day cap is what keeps T-A below its upgrade trigger. Extending the window past
two weeks is not free — it picks up the KV migration.

### D3. Domain, and the rename
**Why:** "Prime Radiant" is a codename. SPEC 13 says do not put it on a domain, and do not
spend more than an hour choosing one.
**Priority:** P2.

---

## Deferred scope (SPEC 2 and SPEC 12)

These are not bugs and not oversights. Each one was considered and left out.

### S1. Accounts, auth, any database
**Why deferred:** state lives in the URL, which means zero infra, zero signup friction, and a
fork mechanic that works better without accounts. **This is load-bearing, not laziness** — it
is why a fork is one click and why there is nothing to migrate.
**What it would unlock:** opens and forks counts on the attribution strip, a model library,
and phase 2 below.
**Cost of adding it:** ends the no-accounts property permanently. Take that decision
deliberately rather than arriving at it. **Effort:** L.

### S2. Phase 2: predictions, resolution dates, calibration
**Why deferred:** retention machinery built before you have traffic is wasted work.
**What it is:** extract a falsifiable prediction with a resolution date, have reality grade it
on that date, accumulate a calibration record across models. That record is a
non-transferable status object, which is the actual moat — a calculator has none.
**Gated on:** interaction rate clearing 15%. Do not build it before then.
**Depends on:** S1, since it needs real persistence and identity. **Effort:** XL.

### S3. Monte Carlo and uncertainty bands
**Why deferred:** adds cognitive load before anyone has demonstrated they care. The four
outcome classes already produce a claim worth arguing with; a confidence band mostly produces
a shrug. **Effort:** M.

### S4. Verticals beyond SaaS runway
**Why deferred:** generalise only after the mechanism is validated in one place. `engine.ts`
would become one implementation behind an interface; do not build the interface first.
**Effort:** L.

### S5. Saved models, versioning, a library
**Why deferred:** requires accounts. See S1. **Effort:** M.

---

## Accepted technical debt

Known, deliberate, and each with the condition that should change the answer.

### T-A. Rate limiting is in-memory and per-instance
**Where:** `app/api/parse/route.ts`.
**Why accepted:** it stops a naive scraper, and the real backstop is a spend cap at the
provider. **Upgrade when:** the run lasts longer than two weeks, or the Anthropic dashboard
shows spend inconsistent with genuine traffic. **Then:** move the bucket to Vercel KV.
**Effort:** S.

### T-B. The URL payload has no short-code fallback
**Where:** `lib/url.ts`, budget 1800 chars, worst case measured at 1748.
**Why accepted:** the budget is enforced at the decode boundary and the caps make an
over-budget payload unreachable through the app. **Upgrade when:** a field needs adding that
does not fit, or the contract moves to v2. **Then:** a short-code service, which introduces
the database S1 avoids. Read `docs/URL-CONTRACT.md` first. **Effort:** M.

### T-C. Analytics events are forgeable
**Where:** `NEXT_PUBLIC_POSTHOG_KEY` is public by construction.
**Why accepted:** there is no fix without a server-side ingest this product deliberately does
not have. **Mitigation:** detection, documented in `docs/MEASUREMENT.md` — discard a run that
looks tampered with. **Upgrade when:** the result is close to a threshold and the sample looks
suspicious.

### T-D. Attacker-authored prose renders on our domain after a click
**Where:** `?d=` carries up to 200 chars of sentence and five assumptions.
**Why accepted:** preview cards are already safe — `shareCard` takes `Params` and structurally
cannot see that text — so the unfurl, which is the wide-blast-radius surface, is closed. The
page itself still renders it, React-escaped.
**Upgrade when:** anyone reports a link used for phishing. **Then:** a content policy on the
payload. **Effort:** M.

### T-E. The parser can still be confidently wrong
**Where:** `normalizeParseResult` catches a field the model *admits* it could not ground. It
cannot tell a wrong number from a right one.
**Mitigation:** `lib/parse-cases.ts`, 12 adversarial cases, run with `pnpm eval:parse`.
**Upgrade when:** the eval finds a failure class not in the set. **Then:** add a case. Always
add a case when changing the prompt.

---

## Small and unclaimed

### U1. The Figma file says 12 months, the code says 24
Resolved in favour of 24 (SPEC 2, and the `plateau_below_burn` headline depends on it). The
**Figma file** is the thing that is now out of date. Update it when convenient. **Effort:** S.

### U2. `pnpm eval:parse` has never run against a real key
The harness is wired and verified to execute rather than skip, but the extraction itself is
unproven. Expect some of the 12 cases to fail on the first run; the fix is usually a prompt
rule, not a looser expectation. **Priority:** P1 the moment a key exists.
