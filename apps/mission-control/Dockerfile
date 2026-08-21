# Multi-stage Dockerfile for the Mission Control console on ECS Fargate
# Build context: project root
#
# Deliberately does NOT run prisma migrate deploy at startup. web-ui and workers
# both already do, and a third racer buys nothing — Mission Control assumes the
# schema is current.

# ── Stage 1: Build (install + compile in one stage so bun module resolution works) ──
FROM public.ecr.aws/docker/library/node:20-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN npm install -g bun@1.3.6

COPY package.json bun.lock ./
COPY apps/mission-control/package.json apps/mission-control/
COPY apps/web-ui/package.json apps/web-ui/
COPY apps/workers/package.json apps/workers/
COPY apps/sdk/package.json apps/sdk/
COPY libs ./libs/
COPY infra/package.json infra/
COPY prisma/ prisma/
COPY tsconfig.base.json ./
COPY nx.json ./
RUN bun install --ignore-scripts

COPY apps/mission-control/ apps/mission-control/

ENV NEXT_TELEMETRY_DISABLED=1
# next.config.ts imports lib/env, which validates at build time. These are
# build-only placeholders; real values arrive from the task definition at runtime.
ENV NEXTAUTH_SECRET=dummy-build-secret
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build

# Inlined into the client bundle by `next build`, so it must be a build arg —
# a task-definition value would arrive too late to affect the browser bundle.
ARG NEXT_PUBLIC_MISSION_CONTROL_URL=http://localhost:3010/mission-control
ENV NEXT_PUBLIC_MISSION_CONTROL_URL=${NEXT_PUBLIC_MISSION_CONTROL_URL}

RUN ./node_modules/.bin/prisma generate --schema=./prisma/schema.prisma
RUN cd apps/mission-control && NODE_OPTIONS="--max-old-space-size=3072" bun run build

# The runner installs Chromium, but only this stage knows which playwright
# version the app resolved. Capture it so the browser binary and the library
# cannot drift apart — playwright pins one exact Chromium revision per release.
RUN node -p "require('playwright/package.json').version" > /tmp/pw-version && cat /tmp/pw-version

# ── Stage 2: Production runner ──
FROM public.ecr.aws/docker/library/node:20-slim AS runner
WORKDIR /app

RUN apt-get update && \
    apt-get install -y curl openssl && \
    rm -rf /var/lib/apt/lists/*
RUN npm install -g bun@1.3.6

RUN curl -sSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    -o /etc/ssl/certs/rds-combined-ca-bundle.pem

ENV PORT=3010 \
    HOSTNAME="0.0.0.0" \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN mkdir -p /tmp/cache && mkdir -p .next/cache

COPY --from=builder /app/apps/mission-control/.next/standalone ./
COPY --from=builder /app/apps/mission-control/.next/static ./apps/mission-control/.next/static
COPY --from=builder /app/prisma ./prisma

RUN ln -sf /tmp/cache ./.next/cache

RUN groupadd -r bun && useradd -r -g bun bun

# Claw's browsing tools (libs/claw-studio/src/agent/browser-session.ts) drive a
# headless Chromium in this process. Interactive chat and the playground resolve
# runs here — apps/mission-control/app/api/{chat,playground}/route.ts call
# resolveClawRuntime directly rather than going through the worker — so without
# this, every browser_* call fails at runtime in exactly the host where a human
# is present to approve it. Mirrors apps/web-ui/Dockerfile and
# apps/workers/Dockerfile, which already install it.
#
# Version is PINNED to whatever the builder resolved, for two reasons:
#
#  - `npm install -g playwright` (unpinned) fetches the LATEST release, which
#    downloads a different `chromium-<revision>` than the app's playwright looks
#    for, so Chromium never launches at runtime.
#  - `npx --yes playwright` does not work here: the runner only receives
#    .next/standalone and playwright is in serverExternalPackages, so there is no
#    local playwright for npx to resolve. That failed the image build outright
#    with `sh: 1: playwright: not found` (exit 127).
#
# Pinning to the builder's resolved version fixes both — the CLI that downloads
# the browser is the same release the application code was compiled against.
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/local/share/playwright-browsers
COPY --from=builder /tmp/pw-version /tmp/pw-version
RUN PW_VERSION="$(cat /tmp/pw-version)" && \
    echo "installing playwright@$PW_VERSION" && \
    npm install -g "playwright@$PW_VERSION" && \
    playwright install-deps chromium && \
    mkdir -p $PLAYWRIGHT_BROWSERS_PATH && \
    playwright install chromium && \
    chown -R bun:bun $PLAYWRIGHT_BROWSERS_PATH

# Fails the BUILD rather than the first user request when the library and the
# downloaded binary disagree, or when `playwright` never made it into the
# standalone output at all (it is in serverExternalPackages, so it is traced
# rather than bundled). Either way the failure surfaces here, in CI, instead of
# as "browser automation isn't available" in a conversation.
RUN node -e "const p=require('/usr/local/lib/node_modules/playwright'); const exe=p.chromium.executablePath(); console.log('chromium ->', exe); require('fs').accessSync(exe);"

RUN chown -R bun:bun /app /tmp/cache
USER bun

EXPOSE 3010

CMD ["node", "apps/mission-control/server.js"]
