# Worker image for Cloud Run. Build from the repository root:
#   docker build -f apps/worker/Dockerfile -t humbled-worker .
# Workspace packages export TypeScript source, so the image runs it with tsx: no build step.
FROM node:22-slim AS deps
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/comedy/package.json packages/comedy/
COPY packages/config/package.json packages/config/
COPY packages/content/package.json packages/content/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/llm/package.json packages/llm/
RUN pnpm install --frozen-lockfile --prod --filter "@humbled/worker..."

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app ./
COPY tsconfig.base.json ./
COPY content ./content
COPY packages ./packages
COPY apps/worker ./apps/worker
# Tests, coverage and local tooling don't ship.
RUN rm -rf packages/*/test apps/worker/test packages/*/coverage
USER node
EXPOSE 8080
WORKDIR /app/apps/worker
CMD ["node", "--import", "tsx", "src/main.ts"]
