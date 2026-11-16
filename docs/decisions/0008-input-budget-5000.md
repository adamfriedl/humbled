# 0008: Raise the default input budget to 5,000 tokens

Status: accepted · 2026-11-16

ADR 0006 left open what to do if the 4,000-token CR-4 budget squeezed out feed context. After
the first real simulation, the house style grew by about 300 tokens (the believability rules
from Adam's read of run 1), and a typical post prompt rose to about 3,650 estimated tokens.
That left room for only one or two feed posts before the builder starts trimming, and the
comedy depends on reacting to the feed.

Decision: raise `llm.maxInputTokens` to 5,000. The cap still guards against runaway prompts
and stays far from the 100K pricing tier.

- Cost: the extra room is mostly feed text, which is uncached. At most about 1,000 more input
  tokens per post prompt, priced at batch rates, keeps the run-1 projection of $0.00335 per
  persona-day under the $0.005 gate. The next simulation's cost report confirms the real
  figure.
- Rejected for now: applying CR-4 only to uncached tokens (ADR 0006's alternative). It's
  the more precise rule, but it changes the budget's meaning and the trimming code. Revisit if
  the cached tiers keep growing.
