# 0009: Database package

Status: accepted · 2026-11-16

`packages/db` holds the Drizzle schema for the PRD data model, committed SQL migrations, the
repositories the worker uses, and `PgSpendLedger` (CR-7). Choices that aren't obvious from the
PRD:

- **Text ids.** House bots keep their content slugs (`brock-halvorsen`) as primary keys, so
  content, logs and the simulator name the same persona the same way. Everything else defaults
  to `gen_random_uuid()::text`.
- **Enums from the domain.** `persona_type`, `post_format`, `reaction_kind` and
  `relationship_stage` are built from `@humbled/domain` constants, and a test checks the
  migrated database against them. Adding a value means a new migration, which is intended.
- **Idempotency key as specified.** `actions` is keyed `(tick_id, persona_id, action_type)`. The
  planner plans at most one action of each kind per persona per tick, so the PRD's key is
  enough. The row also stores the planned action (`plan`) and its `batch_id`, so `/collect` can
  commit a generation result against the plan that produced it.
- **Batch bookkeeping.** `llm_batches.requests` maps each request's custom id to its context.
  `markBatch` only succeeds once, so overlapping `/collect` runs can't both write results.
- **UTC days.** The spend ledger and daily quotas use UTC calendar days, like `dayKey` in
  `@humbled/llm`, so the simulator and production budget the same way. (The Scheduler jobs run
  on Pacific time; only budgets and quotas are UTC.)
- **Embeddings.** `posts.embedding` is `vector(768)`, the width of Vertex AI text embeddings
  (the PRD's default `Embedder`). The first migration enables pgvector.
- **Re-seeding is safe.** House bots are upserted from content on deploy, but their career
  summaries survive, relationship seeds never overwrite live relationships, and published
  world events keep their dates.
- **Tests run against real Postgres.** Testcontainers starts `pgvector/pgvector:pg16`, the same
  image as `docker-compose.yml`, once per test run. `DATABASE_URL` points tests at an existing
  database instead. The generated migration metadata is excluded from Prettier.
