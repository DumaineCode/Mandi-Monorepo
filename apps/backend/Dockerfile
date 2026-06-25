# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Medusa v2 backend — multi-stage build for a pnpm + turbo monorepo.
#
# IMPORTANT: the Docker build context MUST be the repository root (".")
# because pnpm workspaces need the root lockfile + every member package.json.
# Dockerfile path:        apps/backend/Dockerfile
# Docker context path:    .
# Build stage (target):   runner
# ---------------------------------------------------------------------------

############################
# Base
############################
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# libc6-compat: glibc shim so native modules (e.g. sharp) work on Alpine/musl
RUN apk add --no-cache libc6-compat
# Use the exact pnpm version pinned in package.json "packageManager"
RUN corepack enable
WORKDIR /server

############################
# Builder
############################
FROM base AS builder
# Toolchain for any native module that has no prebuilt musl binary
RUN apk add --no-cache python3 make g++

# 1) Install workspace deps first (this layer is cached until a manifest changes)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/storefront/package.json ./apps/storefront/
RUN pnpm install --frozen-lockfile

# 2) Build only the backend -> outputs a self-contained app in .medusa/server
COPY apps/backend ./apps/backend
RUN pnpm --filter @dtc/backend run build

# 3) Install runtime deps INSIDE the standalone build output.
#    npm gives a flat node_modules (no symlinks), so it copies cleanly between
#    stages. This is the official Medusa v2 production step.
RUN cd apps/backend/.medusa/server && npm install --no-audit --no-fund

############################
# Runner
############################
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=9000
WORKDIR /app

# Copy the self-contained server (compiled code + node_modules + built admin)
COPY --from=builder --chown=node:node /server/apps/backend/.medusa/server ./

USER node
EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:9000/health || exit 1

# Apply pending DB migrations, then start the API + admin in one process.
CMD ["sh", "-c", "node_modules/.bin/medusa db:migrate && node_modules/.bin/medusa start"]
