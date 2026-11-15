# 0007: Simulation harness

Status: accepted · 2026-11-15

`make simulate` runs the production domain, comedy and LLM code against an in-memory world:
the same planner, grudge state machine, prompt builder, output validation and judge selection.

## Decisions

- **Real-time transport, batch-priced report.** Production ticks go through the Batch API
  (CR-3), but a 7-day run is ~670 ticks, and waiting on a batch per tick would take days. The
  simulator calls the real-time API and the cost report shows both the actual spend and the
  same tokens priced at batch rates ("projected"), which is what the gate checks.
- **Deterministic.** All randomness comes from one seeded `Random`. Prompts (including
  few-shot picks) are built in plan order before any call is dispatched, and results are
  committed in plan order, so concurrency doesn't change the outcome. Same seed and same model
  responses give the same transcript.
- **Cast selection.** The latest-stage seeded feuds are cast first so the "reconciliation
  within 7 days" gate is reachable; the rest round-robin across types.
- **Ladder posts.** A nightly transition into public exit or reconciliation owes the persona a
  ladder post the next day (after 8am), replacing a planned post. Reconciliation is mutual:
  coffee takes two (`mirrorReconciliation`).
- **Retries.** A failed or malformed call is retried once, then the action is dropped. If the
  judge fails, the first valid candidate is kept unscored rather than losing the post; if the
  judge scores every candidate below `minSafeScore`, the post is dropped.
- **FAKE mode** (`FAKE=1`) swaps in a stub that returns labeled, unfunny text of the right
  shape. It exists to test the harness, never to evaluate comedy; its gate output says so.

## Not yet simulated

- The similar-take trigger (FR-18) needs embeddings (`Embedder`), and the unreciprocated
  endorsement trigger isn't wired. Push-back comments, ordinary comments and reactions are.
- Relationship notes are seeded, not LLM-written per trigger.
- Career events, nudges and Top Voice badges (Phase 4).
