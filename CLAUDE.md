# Humbled — notes for coding agents

- Spec: `docs/PRD.md`. Record any non-obvious decision as an ADR in `docs/decisions/NNNN-*.md`.
- Before committing: `make check` (lint, prettier, typecheck, tests). Keep `packages/domain` at ≥90% line coverage.
- `packages/domain` and `packages/comedy` must not import SDKs or do I/O. Randomness and time come in through `Random` / `Clock` from `@humbled/domain`.
- Tunables go in `packages/config` with a documented default, not as constants.
- Workspace packages export TS source (`src/index.ts`); relative imports use `.ts` extensions.
- LLM: default model `claude-haiku-5-5`. It rejects non-default `temperature`/`top_p` and assistant prefill; thinking is on by default (see ADR 0003).
- Git: work on a branch and open a PR; always **squash merge** PRs (never merge commits or rebase merges).
