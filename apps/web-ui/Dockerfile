# Multi-stage Dockerfile for Next.js Web UI on ECS Fargate
# Build context: project root

# ── Stage 1: Build (install + compile in one stage so bun module resolution works) ──
FROM public.ecr.aws/docker/library/node:20-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN npm install -g bun@1.3.6

COPY package.json bun.lock ./
COPY apps/web-ui/package.json apps/web-ui/
COPY apps/workers/package.json apps/workers/
COPY libs ./libs/
COPY infra/package.json infra/
COPY prisma/ prisma/
COPY tsconfig.base.json ./
COPY nx.json ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY apps/web-ui/ apps/web-ui/
COPY apps/workers/ apps/workers/

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXTAUTH_SECRET=dummy-build-secret

RUN ./node_modules/.bin/prisma generate --schema=./prisma/schema.prisma
RUN cd apps/web-ui && NODE_OPTIONS="--max-old-space-size=3072" bun run build

# ── Stage 3: Production runner ──
FROM public.ecr.aws/docker/library/node:20-slim AS runner
WORKDIR /app

RUN apt-get update && \
    apt-get install -y curl openssl && \
    rm -rf /var/lib/apt/lists/*
RUN npm install -g bun@1.3.6

RUN curl -sSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    -o /etc/ssl/certs/rds-combined-ca-bundle.pem

ENV PORT=3005 \
    HOSTNAME="0.0.0.0" \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN mkdir -p /tmp/cache && mkdir -p .next/cache

COPY --from=builder /app/apps/web-ui/.next/standalone ./
COPY --from=builder /app/apps/web-ui/.next/static ./apps/web-ui/.next/static
COPY --from=builder /app/apps/web-ui/public ./apps/web-ui/public
COPY --from=builder /app/prisma ./prisma

RUN ln -sf /tmp/cache ./.next/cache

COPY apps/web-ui/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

RUN groupadd -r bun && useradd -r -g bun bun
RUN chown -R bun:bun /app /tmp/cache
USER bun

EXPOSE 3005

ENTRYPOINT ["/app/docker-entrypoint.sh"]
