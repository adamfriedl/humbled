# 0003: Claude Haiku 5.5 thinking and cost

Status: proposed · 2026-11-15 (to be settled by simulation in Phase 0)

Claude Haiku 5.5 runs adaptive thinking **by default** (effort defaults to `medium`), and
thinking tokens bill as output. Left on, thinking could plausibly multiply output cost several
times over for 40–180-word posts, which would blow the CR-5 output caps (`max_tokens` 400 counts
thinking too) and the per-persona budget.

Also relevant: Haiku 5.5 rejects non-default `temperature`/`top_p`, and assistant prefill
returns a 400. Variety must come from the prompt (format rotation, few-shot rotation, feed
sample), not sampling knobs. JSON output uses structured outputs (`output_config.format`).

## Plan

`packages/llm` makes thinking/effort a per-call-type config. Phase 0 simulation compares
(a) thinking disabled vs (b) `effort: low` on judge score and cost per persona-day. Default to
thinking disabled unless (b) is measurably funnier for affordable cost.

## Cost sanity check (list prices, ≤100K-token prompts)

Haiku 5.5: $0.10 / MTok input, $0.50 / MTok output; cache reads 0.1×; batch 50% off.
Per persona-day (3 posts, 10 comments, 1 summary ≈ 14 calls × ~3K input, ~1.75K output total),
batched and before caching: input ≈ $0.0021, output ≈ $0.0004, so ≈ $0.0025/day ≈ $0.075/month.
That's inside the PRD target of $0.10/month with room to spare, _if_ thinking is off.
