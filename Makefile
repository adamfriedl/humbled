PERSONAS ?= 10
DAYS ?= 7
SEED ?= 1

.PHONY: install check test lint typecheck simulate

install:
	pnpm install

check: lint typecheck test

lint:
	pnpm lint && pnpm format:check

typecheck:
	pnpm typecheck

test:
	pnpm test

# Phase 0 harness: N personas for D simulated days against the real model (needs
# HUMBLED_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY), or FAKE=1 to exercise the harness offline. Output in tools/simulate/runs/.
FAKE ?=
MAX_USD ?= 2
simulate:
	pnpm --filter @humbled/simulate exec tsx src/cli.ts --personas $(PERSONAS) --days $(DAYS) --seed $(SEED) --max-usd $(MAX_USD) $(if $(FAKE),--fake,)
