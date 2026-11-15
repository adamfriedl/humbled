# 0004: Content format and golden-set workflow

Status: accepted · 2026-11-15

- Content is YAML (persona types, world data, nudges, golden posts) and Markdown (house style,
  safety rules, judge rubric). `packages/content` owns the zod schemas and the loader. Its tests
  load the real `content/` directory, so a malformed file fails CI rather than a tick.
- YAML keys are snake_case (they're data files edited by humans); `toPlannerProfile` maps them
  onto the domain's camelCase types.
- Per-tick action rates are calibrated to the 15-minute tick: `post × 96` must land at 2 to 4
  posts/day, enforced in tests.
- **Golden set:** the PRD wants 30 hand-picked excellent posts. Candidates are drafted in
  `content/eval/golden/candidates.yaml` with `approved: false`; a human flips the ones that
  land. Only approved entries are used for few-shot rotation and judge calibration, so the
  comedy bar is set by human taste, not by the model grading itself.
- A seed brand blocklist in the content tests catches real brands in prompt-facing content.
  It's not the SR-4 checker; that comes in `packages/safety`.
