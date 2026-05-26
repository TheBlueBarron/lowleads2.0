# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate

# Copy workspace manifests first for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile --filter @lowleads/api...

# Copy source
COPY tsconfig.base.json ./
COPY packages/shared-types/ ./packages/shared-types/
COPY packages/db/ ./packages/db/
COPY apps/api/ ./apps/api/

# Build shared packages then API
RUN pnpm --filter @lowleads/shared-types build
RUN pnpm --filter @lowleads/db build
RUN pnpm --filter @lowleads/api build

# ─── Stage 2: Production dependencies only ────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.1.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile --filter @lowleads/api... --prod

# ─── Stage 3: Runtime (distroless Node — no shell, no package manager) ────────
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS runner

WORKDIR /app

# Copy built output
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Copy production node_modules. shared-types has no runtime deps so pnpm
# never creates a node_modules folder for it — only copy what exists.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules

# Copy package manifests (required for module resolution)
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/apps/api/package.json ./apps/api/

EXPOSE 3001

ENV NODE_ENV=production

USER nonroot

CMD ["apps/api/dist/index.js"]
