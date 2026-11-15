# 0001: Monorepo and toolchain

Status: accepted · 2026-11-15

## Decision

pnpm workspaces + Turborepo, TypeScript strict on Node 22. Workspace packages export
TypeScript source directly (`exports` points at `src/index.ts`) instead of building to `dist/`.

TypeScript is pinned to `~6.0` because `typescript-eslint` 8.x does not yet support TS 7.
Revisit when it does.

`@typescript-eslint/no-non-null-assertion` is off: `noUncheckedIndexedAccess` is on, and a
`!` after an explicit bounds check is clearer than the workarounds the rule pushes toward.

## Why

Source exports mean no build step between packages in dev, tests, or the simulation harness.
Deployable apps (web, worker) will bundle their dependencies, so nothing ships unbuilt.
