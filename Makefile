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

# Phase 0 harness (tools/simulate) — not implemented yet.
simulate:
	@echo "tools/simulate is not built yet (Phase 0, next up). PERSONAS=$(PERSONAS) DAYS=$(DAYS) SEED=$(SEED)"; exit 1
