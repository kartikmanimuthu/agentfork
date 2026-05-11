# Multi-stage Dockerfile for Next.js Web UI on ECS Fargate
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
FROM node:20-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/libs ./libs
COPY --from=deps /app/prisma ./prisma
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/bun.lock ./bun.lock
COPY --from=deps /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=deps /app/nx.json ./nx.json

COPY apps/web-ui/ apps/web-ui/
COPY apps/workers/ apps/workers/

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXTAUTH_SECRET=dummy-build-secret

RUN npx prisma@6 generate --schema=./prisma/schema.prisma
RUN cd apps/web-ui && npm run build

# ── Stage 3: Production runner ──
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

COPY --from=builder /app/apps/web-ui/.next/standalone ./
COPY --from=builder /app/apps/web-ui/.next/static ./.next/static
COPY --from=builder /app/apps/web-ui/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

RUN ln -sf /tmp/cache ./.next/cache

COPY apps/web-ui/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

RUN chown -R bun:bun /app /tmp/cache
USER bun

EXPOSE 3001

ENTRYPOINT ["/app/docker-entrypoint.sh"]
