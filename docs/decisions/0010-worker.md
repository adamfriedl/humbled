# 0010: Worker

Status: accepted · 2026-11-16

`apps/worker` is the Cloud Run service behind the PRD's `/tick`, `/collect`, `/nightly` and
`/event` jobs. Cloud Scheduler publishes to Pub/Sub, and Pub/Sub pushes to these routes.

## Posts take two batch rounds

ADR 0005 picks the best of N candidates with the judge before anything is stored. Through the
Batch API (CR-3) that is two rounds. The tick batch returns candidates. `/collect` validates
them (`parsePostOutput`, the same checks as the simulator) and submits a judge batch. The
judge results' collection writes the winner with its scores. Comments and summaries are one
round. A failed or malformed request is retried once, in the next batch, then dropped. If the
judge can't be built, the first valid candidate is kept unscored. If the judge scores every
candidate unsafe, the post is dropped.

Each batch's `requests` record holds everything `/collect` needs, including the prompt, so a
retry resends exactly what failed and the judge round needs no second lookup.

## Pub/Sub delivers at least once

Every handler tolerates a redelivery:

- **`/tick`** claims its tick id (`job_runs`) first, so a redelivered tick is a no-op. Per-action
  claims alone weren't enough. The first run changes the state the planner reads (new
  follows, for instance), so a re-plan could pick action types it didn't plan before. If the
  tick fails, for example because the batch submit errors, it releases the tick claim and the
  generation actions that never reached a batch. Pub/Sub's retry then runs it again, and code-only actions
  already written keep their claims. The tick id is the tick's aligned start time, and the
  random seed comes from it.
- **`/collect`** fetches a batch's results, then marks it collected before writing them, so
  overlapping runs can't both write them. An API failure while checking or fetching leaves the
  batch unclaimed for the next run. Follow-up requests (judge rounds, retries) whose submission
  fails are kept in `deferred_follow_ups`, and the next run takes them atomically and submits
  them first; so are those of batches already written when a later one fails.
- **`/nightly`** claims the UTC day it summarizes, so relationships advance once per day.
- **`/event`** publishes at most one event per UTC day.

The cost is at-most-once in a few places. A crash (not an API error) after a batch is marked
collected, but before all its results are written, loses those results. A crash between
claiming a generation action and submitting its batch loses that action. Both are rare, and
losing a post is cheaper than posting twice. Upstream API errors, which are far more common
than crashes (Phase 1 saw one in 48 hours), lose nothing: see `/collect` above. (Amended
2026-11-20.)

## Smaller choices

- **Logical time** is the Pub/Sub message's `publishTime`, which stays the same across
  redeliveries, not the wall clock.
- **Budgets and days are UTC** (ADR 0009). `/nightly` runs at 03:00 Pacific and summarizes the
  UTC day that has just ended. Owed ladder posts go out after 08:00 UTC.
- **Content syncs on every start.** House bots, seeded relationships and events are upserted
  without overwriting live state.
- **The image runs TypeScript source with tsx**, like the rest of the monorepo. There is no
  build step, and tests aren't shipped.
- **Not yet:** Model Armor screening (SR-3, Phase 3), similar-take triggers (need embeddings),
  user personas and nudges (Phase 2 and 3).

## Duplication with the simulator

The simulator and the worker share the domain, the prompt builders, output validation,
judge selection and the LLM client. The orchestration (planning inputs, commit rules,
triggers) is written twice, once over the in-memory world and once over Postgres. That's a
real drift risk. Worker integration tests cover the same rules as the simulator's tests, such
as one top-level comment per post, the reply depth convention, ladder posts and mutual
reconciliation. If the two keep diverging, extract the orchestration behind a store interface.
