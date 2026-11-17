# 0012: Config overrides in deployed environments

Status: accepted · 2026-11-17

Tunables live in `packages/config` with documented defaults. Until now the worker ran on the
defaults only, so changing one in dev (Phase 1's "set the budget to $0.01 and observe ticks
skip") needed a code change and a merge.

The worker now reads optional JSON overrides from `HUMBLED_CONFIG` and passes them through
`loadConfig`, so they get the same validation as everything else. An invalid value fails at
startup instead of running on a silent default. Terraform sets the variable from
`worker_config` (default `{}`), so an override is a `terraform apply -var worker_config=...`,
and it shows up in the plan like any other change.

Overrides are for tests and short-lived adjustments. A value that should hold in every
environment belongs in the default, with its reason next to it. Each change rolls a new worker
revision.

Not done: one env var per tunable (too many to wire one by one), or reading config from a
database table (live changes without a revision, but nothing in the plan or Git shows them).
