# Deploy and post-deploy checklist

No database, no migrations, no feature flags. Deployment is a static build plus three dynamic
routes, so the risk is not the deploy mechanics — it is shipping with the measurement
instrument subtly broken, which is exactly what the last several fixes were about.

Rollback is `git revert` plus redeploy, or Vercel's instant rollback to the previous
deployment. There is no state to migrate back.

## Before the first deploy

- [ ] **Spend cap on the Anthropic key.** The in-memory rate limiter is per-instance and
      resets on cold start, so it cannot enforce a budget across serverless functions. The
      cap at the provider is the only real backstop. Exposure without it is about $950 per
      million parses.
- [ ] `ANTHROPIC_API_KEY` set in Vercel. Without it the app still works and falls back to
      manual entry, but you are not testing the product you meant to test.
- [ ] `NEXT_PUBLIC_POSTHOG_KEY` set, or the run measures nothing.
- [ ] `NEXT_PUBLIC_SITE_URL` set to the real origin. Relative og:image URLs resolve against
      `metadataBase`; leave it unset and preview cards point at localhost.
- [ ] `pnpm build` passes locally.
- [ ] `pnpm test` passes. 115 offline tests, no network.
- [ ] `pnpm eval:parse` run once against the real key. This is the only check that the
      extraction actually works; everything else tests the fallback.
- [ ] Read `docs/MEASUREMENT.md` and set the window length and start date.
- [ ] Opt your own browsers out of PostHog, or note your `distinct_id` to filter later.
      Decide before launch, not after seeing the number.

## First five minutes after deploy

Do these in order. Items 3 and 4 are the ones that have actually been broken before.

1. [ ] **`/` loads** and the composer accepts a sentence.
2. [ ] **A real parse succeeds.** Submit the Pre-seed SaaS example chip. You should land on
       `/m` with six grounded numbers, not the manual-entry fallback. Then check the runtime
       log for a line with `"outcome":"ok"`. Any other outcome is named; look it up in
       `lib/parse.ts`.
3. [ ] **A shared link unfurls with its own verdict.** Copy the link, paste it into a Slack
       DM to yourself or a draft post. The card must read the verdict headline, not
       "A runway model you can argue with". That generic card means `generateMetadata` is not
       seeing the payload, which is how every shared link looked before T9.
4. [ ] **`/api/og?d=<payload>` returns `image/png`** with
       `cache-control: public, max-age=31536000, immutable`. Missing cache headers turn every
       unfurl into a fresh 200-500ms render.
5. [ ] **Open a shared link on a real phone** and drag a slider. Not a resized desktop window:
       touch sizing keys on `(pointer: coarse)`, which a narrow desktop window does not match.
6. [ ] **PostHog received `link_opened` and `slider_moved`**, both carrying
       `run: MEASUREMENT_RUN`. If `run` is missing, the sample cannot be segmented later.
7. [ ] **`$current_url` in PostHog shows `d=redacted`.** If the full payload is there, the
       founder's cash position is going to a third party.

## First hour

- [ ] Watch the runtime logs for any `"evt":"parse"` line with an outcome other than `ok`,
      `no_key` or `bad_input`. `key_rejected`, `unavailable` and `truncated` all need a human.
- [ ] Confirm the Anthropic dashboard shows spend consistent with the number of parses. A
      large gap means something is calling the route that should not be.
- [ ] Open the golden payload from `lib/contract.test.ts` against production. If it does not
      decode, the deployed build is not the one the contract test passed on.

## Day one and two

- [ ] Check the funnel before posting anything publicly. Confirm all the events arrive with
      the properties you expect. The failure to avoid is discovering on day fourteen that the
      key was misconfigured the whole time.
- [ ] Record the deploy timestamp. `docs/MEASUREMENT.md` discards the five minutes around
      each deploy, and that is only possible if you wrote them down.

## What invalidates the run

Any deploy touching the composer, the model page, the slider panel or the analytics restarts
the sample. Bump `MEASUREMENT_RUN` in `lib/analytics.ts` and do not pool the data.
