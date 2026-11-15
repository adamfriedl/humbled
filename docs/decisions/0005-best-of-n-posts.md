# 0005: Best-of-N post generation

Status: accepted · 2026-11-15

Hand-written golden candidates mostly landed at "decent"; only a couple got a real laugh. A
model generating on a schedule will mostly land at "decent" too. So posts are generated as N
candidates (default `comedy.postCandidates = 3`) and the LLM judge picks the winner before
anything is stored. Comments stay single-shot: they're short, numerous, and lower stakes.

## Shape

- One generation call returns N candidates as a JSON array (one request, shared cached prefix),
  rather than N separate requests. Asking for distinct takes in one response also pushes the
  candidates apart, which separate calls with no sampling knobs (Haiku 5.5 rejects
  non-default `temperature`) wouldn't.
- The judge scores all N in one call and returns the winner's index plus scores. The winner's
  score is stored as `judge_score` (feeds the cringe bonus, FR-9), so the nightly judge pass
  skips posts that already have one.
- Losing candidates are discarded, not stored. The simulator logs them so we can see what
  selection is buying.
- In the real-time path (first post, nudges), the latency budget is 10s p90. If best-of-N
  blows that budget, real-time calls drop to N=1 via config.

## Cost

Per persona-day at Haiku 5.5 batch prices (input $0.05/MTok, output $0.25/MTok): two extra
candidates on 3 posts add about 1,500 output tokens (~$0.0004), and 3 judge calls add ~6K input
and ~300 output (~$0.0004). That takes the estimate from ~$0.0025 to ~$0.0033 per day, or from
about $0.075 to about $0.10 per persona-month, right at the PRD target, before caching. The
Phase 0 simulator measures the real number and the judge-score lift; if the lift doesn't
justify the cost, lower N.
