# Multi-stage Dockerfile for pg-boss workers on ECS Fargate (ARM64)
# Build context: project root

# ── Stage 1: Dependencies ──
FROM oven/bun:1-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web-ui/package.json apps/web-ui/
COPY apps/workers/package.json apps/workers/
COPY libs ./libs/
COPY infra/package.json infra/
COPY prisma/ prisma/
COPY tsconfig.base.json ./
COPY nx.json ./
RUN bun install --frozen-lockfile

# ── Stage 2: Build ──
FROM oven/bun:1-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/workers/node_modules ./apps/workers/node_modules
COPY --from=deps /app/libs ./libs
COPY --from=deps /app/prisma ./prisma
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/bun.lock ./bun.lock
COPY --from=deps /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=deps /app/nx.json ./nx.json

COPY apps/workers/ apps/workers/

RUN rm -f prisma/.env
RUN ./node_modules/.bin/prisma generate --schema=./prisma/schema.prisma
RUN cd apps/workers && bunx tsc --noEmit false

# ── Stage 3: Production runner ──
FROM oven/bun:1-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y openssl curl && rm -rf /var/lib/apt/lists/*

RUN curl -sSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    -o /etc/ssl/certs/rds-combined-ca-bundle.pem

COPY --from=builder /app/apps/workers/dist ./dist
COPY --from=builder /app/apps/workers/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/workers/node_modules ./apps/workers/node_modules
COPY --from=builder /app/prisma ./prisma

ENV NODE_ENV=production
USER bun

CMD ["bun", "run", "dist/index.js"]
