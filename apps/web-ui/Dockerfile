# Multi-stage Dockerfile for Next.js Web UI on ECS Fargate
# Build context: project root (not apps/web-ui/) — required to include prisma/

# ── Stage 1: Install dependencies with Bun ──
FROM oven/bun:1-slim AS deps
WORKDIR /app

COPY apps/web-ui/package.json apps/web-ui/bun.lock* ./
RUN bun install --frozen-lockfile --production

# ── Stage 2: Install all deps ──
FROM oven/bun:1-slim AS deps-all
WORKDIR /app

COPY apps/web-ui/package.json apps/web-ui/bun.lock* ./
RUN bun install --frozen-lockfile

# ── Stage 3: Build with Node ──
FROM node:20-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=deps-all /app/node_modules ./node_modules
COPY apps/web-ui/package.json ./
COPY apps/web-ui/ .
COPY prisma/ ./prisma/
COPY libs/ ./libs/

ENV NEXT_TELEMETRY_DISABLED=1

RUN npx prisma@6 generate --schema=./prisma/schema.prisma
RUN npm run build

# ── Stage 4: Production runner (Bun) ──
FROM oven/bun:1-slim AS runner
WORKDIR /app

RUN apt-get update && \
    apt-get install -y curl openssl && \
    rm -rf /var/lib/apt/lists/*

RUN curl -sSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    -o /etc/ssl/certs/rds-combined-ca-bundle.pem

ENV PORT=3001 \
    HOSTNAME="0.0.0.0" \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN mkdir -p /tmp/cache && mkdir -p .next/cache

COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/prisma ./prisma

RUN ln -sf /tmp/cache ./.next/cache

COPY apps/web-ui/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

RUN chown -R bun:bun /app /tmp/cache
USER bun

EXPOSE 3001

ENTRYPOINT ["/app/docker-entrypoint.sh"]
