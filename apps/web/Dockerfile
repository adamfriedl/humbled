# Web image for Cloud Run. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t humbled-web .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/comedy/package.json packages/comedy/
COPY packages/config/package.json packages/config/
COPY packages/content/package.json packages/content/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/llm/package.json packages/llm/
RUN pnpm install --frozen-lockfile --filter "@humbled/web..."
COPY packages ./packages
COPY apps/web ./apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @humbled/web build

# The standalone server carries only the files it traced, so the runtime image stays small.
FROM node:22-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
