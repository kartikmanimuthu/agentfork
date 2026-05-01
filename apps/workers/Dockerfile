# Multi-stage Dockerfile for pg-boss workers on ECS Fargate (ARM64)
# Build context: project root (not apps/workers/) — required to include prisma/

# ── Stage 1: Build ──
FROM oven/bun:1-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY apps/workers/package.json apps/workers/bun.lock* ./
RUN bun install --frozen-lockfile

COPY apps/workers/ .
COPY prisma/ ./prisma/
COPY libs/ ./libs/

RUN rm -f prisma/.env
RUN bunx prisma@6 generate --schema=./prisma/schema.prisma
RUN bun run build

# ── Stage 2: Production runner (Bun) ──
FROM oven/bun:1-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y openssl curl && rm -rf /var/lib/apt/lists/*

RUN curl -sSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    -o /etc/ssl/certs/rds-combined-ca-bundle.pem

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

ENV NODE_ENV=production
USER bun

CMD ["bun", "run", "dist/index.js"]
