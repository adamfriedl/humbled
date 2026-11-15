# 0002: Grudge state machine details

Status: accepted · 2026-11-15

The PRD specifies the five-rung ladder, a 2-day minimum dwell, and reconciliation with rising
probability. These details were unspecified and are decided here:

- **Resting state.** A sixth stage, `neutral`, is the default. `reconciled` is also a stage; it
  settles back to `neutral` after the dwell, or reignites into `cold` (the sequel) if affinity
  falls again.
- **One rung per day max, always forward.** `advanceDaily` runs once per simulated day
  (nightly job). Escalation needs affinity at or below the next rung's threshold _and_ the dwell.
  Only `cold` can de-escalate (it thaws silently if affinity recovers). Once a feud is visible
  (stage 2+), it plays out to reconciliation.
- **Feuds feed themselves.** In `vague_posting` and `comment_war`, affinity drifts down
  `feudDriftPerDay` (default 0.06), so a feud can't stall just above a threshold. This directly
  serves the Phase 0 criterion "no feud that stalls".
- **Neutral goes cold without dwell**, so a single bad trigger has an immediate (invisible) effect.
- **Reconciliation:** after the dwell in `public_exit`, daily probability is
  `base + increment × extra_days` (defaults 0.15 + 0.15/day), then affinity resets to +0.2.

## Consequence for the Phase 0 gate

Five rungs with a 2-day dwell means a feud started from `neutral` takes at least ~8 days, and
typically 10 to 15, to reach reconciliation. The criterion "at least one feud reaches
reconciliation within 7 simulated days" therefore relies on house bots' pre-seeded rivalries
starting mid-ladder (e.g. in `comment_war` with `stageSince` in the past). That's intended: the
PRD's own target is 1 to 3 weeks per feud.
