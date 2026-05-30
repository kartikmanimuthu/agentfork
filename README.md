# Chatbot

Open-source, multi-tenant AI chatbot platform powered by AWS Bedrock. Self-hosted, MIT licensed.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What is this?

Chatbot is a production-ready, self-hosted AI chat platform you can deploy on your own infrastructure. It supports multiple organizations (tenants), role-based access control, persistent conversation history, and RAG (retrieval-augmented generation) via pgvector — all powered by Claude on AWS Bedrock.

**Live pages once running:**
- `http://localhost:3001` — marketing landing page
- `http://localhost:3001/docs` — documentation site
- `http://localhost:3001/chat` — the chat application

---

## Monorepo Structure

This project uses **Nx** as the monorepo build system with **Bun** as the package manager.

```
chatbot/                          # Nx workspace root
├── apps/
│   ├── web-ui/                   # Next.js 15 — frontend, API routes, docs, marketing
│   └── workers/                  # pg-boss background job processor
├── libs/
│   ├── shared/                   # Database repos, auth, RBAC, services
│   └── ai/                       # AWS Bedrock client, chat completion, embeddings
├── prisma/                       # Unified schema and migrations
├── infra/                        # Pulumi AWS infrastructure stacks
├── tests/e2e/                    # Playwright end-to-end tests
├── nx.json                       # Nx workspace configuration
└── docker-compose.yml            # Local PostgreSQL with pgvector
```

**Nx projects:** `web-ui`, `workers`, `shared`, `ai`

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| [Bun](https://bun.sh) | 1.2+ | `curl -fsSL https://bun.sh/install \| bash` |
| [Node.js](https://nodejs.org) | 20+ | via [nvm](https://github.com/nvm-sh/nvm) or direct download |
| [Docker](https://docs.docker.com/get-docker/) | any recent | for PostgreSQL |
| AWS account | — | with Bedrock access (Claude models enabled) |

---

## Local Setup

### 1. Clone and install

```bash
git clone https://github.com/kartikmanimuthu/chatbot.git
cd chatbot
bun install
```

### 2. Start PostgreSQL

The repo includes a `docker-compose.yml` that runs PostgreSQL 16 with pgvector pre-installed:

```bash
docker compose up -d
```

This starts a container with:
- Host: `localhost:5432`
- Database: `chatbot`
- User: `chatbot_admin`
- Password: `chatbot_dev`

Verify it's running:

```bash
docker compose ps
```

### 3. One-command setup

```bash
bun run setup
```

This single command:
1. Copies `.env.example` → `.env` at the repo root (if not already present)
2. Generates the Prisma client
3. Runs all database migrations

All projects — web-ui, workers, shared, ai — automatically inherit from the single root `.env` via Nx's built-in env loading. No per-app env files, no symlinks.

### 4. Install Playwright browser (required for web crawling)

The knowledge base worker uses **Playwright** for headless browser crawling. You must install the Chromium binary once:

```bash
npx playwright install chromium
```

> **Note:** This downloads ~150MB of browser binaries. If you skip this step, web crawl jobs for URL sources will fail with a "browser not found" error.

Then edit `.env` and fill in your real values:

```env
# Required — generate with: openssl rand -base64 32
NEXTAUTH_SECRET=your-nextauth-secret-min-32-chars

# Required — AWS region with Bedrock access
AWS_REGION=ap-south-1

# Optional — explicit AWS credentials (skip if using AWS CLI profile or IAM role)
# AWS_ACCESS_KEY_ID=your-access-key-id
# AWS_SECRET_ACCESS_KEY=your-secret-access-key

# Optional — Cognito SSO (credentials login works without these)
# COGNITO_APP_CLIENT_ID=your-app-client-id
# COGNITO_APP_CLIENT_SECRET=your-app-client-secret
# COGNITO_ISSUER=https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_example
```

`DATABASE_URL`, `NEXTAUTH_URL`, and Bedrock model IDs are pre-filled with defaults that match the docker-compose setup.

### 5. Start the development server

```bash
bun run dev
# or: bunx nx serve web-ui
```

Open http://localhost:3001. You should see the marketing landing page.

**Sign up** to create your first account and organization, then navigate to `/chat`.

### 6. Start background workers (optional)

Workers handle message embedding generation and conversation summarization. In a separate terminal:

```bash
bun run dev:workers
# or: bunx nx serve workers
```

### 7. Start everything in parallel

```bash
bun run dev:all
# or: bunx nx run-many -t serve -p web-ui,workers --parallel
```

---

## Nx Commands Reference

All commands run from the **repo root**.

### Development

| Command | What it does |
|---------|-------------|
| `bun run setup` | Copy env examples, generate Prisma client, run migrations |
| `bun run dev` | Start web-ui dev server (port 3001) |
| `bun run dev:workers` | Start workers in watch mode |
| `bun run dev:all` | Start web-ui + workers in parallel |
| `bunx nx serve web-ui` | Same as `bun run dev` |
| `bunx nx serve workers` | Same as `bun run dev:workers` |

### Building

| Command | What it does |
|---------|-------------|
| `bun run build` | Build all projects |
| `bun run build:web` | Build web-ui only |
| `bun run build:workers` | Build workers only |
| `bunx nx build web-ui` | Build web-ui via Nx |
| `bunx nx build shared` | Build shared lib |
| `bunx nx build ai` | Build ai lib |

### Testing

| Command | What it does |
|---------|-------------|
| `bun run test` | Run unit tests for shared, ai, workers |
| `bun run test:shared` | Unit tests for libs/shared (65 tests) |
| `bun run test:ai` | Unit tests for libs/ai (13 tests) |
| `bun run test:workers` | Unit tests for apps/workers |
| `bun run e2e` | Run Playwright e2e tests (51 tests) |
| `bun run e2e:ui` | Open Playwright interactive UI |

### Nx-specific

| Command | What it does |
|---------|-------------|
| `bun run affected:test` | Run tests only for changed projects |
| `bun run affected:build` | Build only changed projects |
| `bun run graph` | Open Nx project dependency graph |
| `bunx nx show projects` | List all Nx projects |
| `bunx nx show project web-ui` | Show all targets for web-ui |

---

## Running Tests

### Unit tests

```bash
# All projects at once
bun run test

# Individual projects
bun run test:shared    # libs/shared — 65 tests
bun run test:ai        # libs/ai — 13 tests
bun run test:workers   # apps/workers

# With coverage report
bunx nx test shared -- --coverage
bunx nx test ai -- --coverage
```

Coverage thresholds are enforced at 60% lines/branches/functions.

### End-to-end tests (Playwright)

Make sure the dev server is **not** already running — Playwright starts it automatically:

```bash
bun run e2e
```

This runs 51 tests across 5 spec files:
- `marketing.spec.ts` — landing page sections
- `docs.spec.ts` — all 7 documentation pages
- `navigation.spec.ts` — authenticated routes and redirect guards
- `auth.spec.ts` — login and register forms

Open the Playwright UI for interactive debugging:

```bash
bun run e2e:ui
```

---

## AWS Bedrock Setup

1. Log in to the [AWS Console](https://console.aws.amazon.com)
2. Go to **Amazon Bedrock → Model access**
3. Enable **Anthropic Claude** models in your region (default: `ap-south-1`)
4. Enable **Amazon Titan Embeddings V2** (used for RAG)
5. Ensure your IAM user/role has these permissions:
   ```json
   {
     "Effect": "Allow",
     "Action": [
       "bedrock:InvokeModel",
       "bedrock:InvokeModelWithResponseStream"
     ],
     "Resource": "*"
   }
   ```

The default chat model is `anthropic.claude-sonnet-4-20250514`. The embedding model is `amazon.titan-embed-text-v2:0`.

---

## Cognito SSO Setup (optional)

To enable "Sign in with SSO" on the login page:

1. Create a **Cognito User Pool** in AWS Console
2. Create an **App Client** with authorization code grant
3. Set the callback URL to `http://localhost:3001/api/auth/callback/cognito`
4. Add to `apps/web-ui/.env.local`:
   ```env
   COGNITO_APP_CLIENT_ID="your-client-id"
   COGNITO_APP_CLIENT_SECRET="your-client-secret"
   COGNITO_ISSUER="https://cognito-idp.<region>.amazonaws.com/<user-pool-id>"
   ```

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Monorepo | Nx | 21 |
| Package Manager | Bun | 1.2 |
| Frontend | Next.js + React | 15 + 19 |
| Styling | Tailwind CSS + Radix UI | 3.4 |
| Documentation | Fumadocs | 14 |
| AI | AWS Bedrock + Vercel AI SDK | Claude Sonnet |
| Database | PostgreSQL + pgvector | 16 |
| ORM | Prisma | 6 |
| Auth | NextAuth.js + Cognito | 4.24 |
| Job Queue | pg-boss | 10 |
| Unit Tests | Vitest | 3 |
| E2E Tests | Playwright | 1.59 |
| Infrastructure | Pulumi (AWS) | 3 |

---

## Common Issues

**`DATABASE_URL` connection refused**
Make sure Docker is running: `docker compose up -d`

**`No secret` NextAuth error**
Set `NEXTAUTH_SECRET` in `apps/web-ui/.env.local`. Generate one with `openssl rand -base64 32`.

**Bedrock `AccessDeniedException`**
Enable the Claude and Titan Embeddings models in your AWS region under Bedrock → Model access.

**`prisma generate` fails**
Run from the repo root: `bun run prepare` (not from inside apps/web-ui).

**Workers not picking up jobs**
Ensure `DATABASE_URL` in `apps/workers/.env` matches the web UI database.

**`nx serve web-ui` fails with version mismatch**
Make sure `next` is not in the root `package.json` devDependencies — it should only be in `apps/web-ui/package.json`.

---

## License

MIT — free to use, modify, and self-host.
