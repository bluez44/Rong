# syntax=docker/dockerfile:1.7
#
# Image backend cho production. Build từ gốc repo (cần cả workspace pnpm):
#   docker build -f apps/backend/Dockerfile -t rong-backend .
#
# Workspace dùng node-linker=hoisted, nên image giữ nguyên cấu trúc monorepo
# (node_modules ở gốc, packages/shared-types) thay vì dùng `pnpm deploy`.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable
WORKDIR /app

# Chỉ manifest: đổi mã nguồn không làm mất cache của bước cài dependency.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/
COPY packages/shared-types/package.json packages/shared-types/

FROM manifests AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@rong/backend..."
COPY packages/shared-types packages/shared-types
COPY apps/backend apps/backend
RUN pnpm --filter @rong/shared-types build \
 && pnpm --filter @rong/backend exec nest build

FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@rong/backend..."

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app ./
COPY --from=build /app/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /app/apps/backend/dist apps/backend/dist
COPY apps/backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
WORKDIR /app/apps/backend
USER node
EXPOSE 3001
ENTRYPOINT ["sh", "/usr/local/bin/docker-entrypoint.sh"]
