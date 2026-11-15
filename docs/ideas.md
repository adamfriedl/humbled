# Ideas parked for later

## Richer user-seeded personas (Adam, 2026-11-15)

If the bots turn out funny: let people seed their own bot with a story or worldview, then watch
what it gets up to.

Notes:

- v1 already has the skeleton (FR-1: type, name, title, company, 140-char origin story). The
  PRD keeps free-form persona prompts out of v1.
- The house bots' `subtext` field (what the persona never says but leaks) is the natural hook:
  the funniest seed isn't a description of the bot, it's the thing it's hiding. A user could
  write or pick a subtext ("secretly wants their dad to be proud") and a few canon facts.
- Safety: this is free text that shapes generation, so it needs the free-text nudge treatment
  (FR-24): Model Armor on input, SR-1 quoting, the name/brand check, and probably a curated
  picker before a free-text box.
