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

### 3. Configure environment variables

**Web UI:**

```bash
cp apps/web-ui/.env.local.example apps/web-ui/.env.local
```

Edit `apps/web-ui/.env.local`:

```env
# Database (matches docker-compose defaults)
DATABASE_URL="postgresql://chatbot_admin:chatbot_dev@localhost:5432/chatbot?schema=public"

# NextAuth — generate a secret with: openssl rand -base64 32
NEXTAUTH_SECRET="your-random-secret-here"
NEXTAUTH_URL="http://localhost:3001"

# AWS Bedrock — needs bedrock:InvokeModel and bedrock:InvokeModelWithResponseStream
AWS_REGION="ap-south-1"
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"

# Cognito SSO (optional — credentials login works without these)
# COGNITO_APP_CLIENT_ID=""
# COGNITO_APP_CLIENT_SECRET=""
# COGNITO_ISSUER=""
```

**Workers** (only needed if running background jobs):

```bash
cp apps/workers/.env.example apps/workers/.env
```

The defaults in `apps/workers/.env` match the docker-compose database, so no edits needed for local dev.

### 4. Run database migrations

```bash
bun run prepare
bunx prisma migrate deploy --schema=./prisma/schema.prisma
```

`bun run prepare` generates the Prisma client. `migrate deploy` applies all migrations to your local database.

### 5. Start the web UI

```bash
cd apps/web-ui && bun run dev
```

Open http://localhost:3001. You should see the marketing landing page.

**Sign up** to create your first account and organization, then navigate to `/chat`.

### 6. Start background workers (optional)

Workers handle message embedding generation and conversation summarization. In a separate terminal:

```bash
cd apps/workers && bun run dev
```

Workers connect to the same PostgreSQL database and pick up jobs queued by the web UI.

---

## Project Structure

```
chatbot/
├── apps/
│   ├── web-ui/              # Next.js 15 app — frontend, API routes, docs, marketing
│   │   ├── app/
│   │   │   ├── page.tsx         # Marketing landing page (/)
│   │   │   ├── (auth)/          # Login and register pages
│   │   │   ├── (dashboard)/     # Authenticated app (chat, conversations, settings)
│   │   │   ├── (docs)/          # Fumadocs documentation site (/docs/*)
│   │   │   └── api/             # REST API routes
│   │   ├── content/docs/        # MDX documentation content
│   │   └── lib/                 # Shared utilities and services
│   └── workers/             # pg-boss background job processor
│       └── src/jobs/            # Job handlers (embeddings, summaries)
├── libs/
│   ├── shared/              # Database repos, auth, RBAC, services
│   └── ai/                  # AWS Bedrock client, chat completion, embeddings
├── prisma/                  # Unified schema and migrations
├── infra/                   # Pulumi AWS infrastructure stacks
├── tests/
│   └── e2e/                 # Playwright end-to-end tests
└── docker-compose.yml       # Local PostgreSQL with pgvector
```

---

## Running Tests

### Unit tests

```bash
# libs/shared — repositories, auth, RBAC, services (65 tests)
cd libs/shared && bunx vitest run

# libs/ai — bedrock client, chat completion, embeddings (13 tests)
cd libs/ai && bunx vitest run
```

With coverage report:

```bash
cd libs/shared && bunx vitest run --coverage
cd libs/ai && bunx vitest run --coverage
```

Coverage thresholds are enforced at 60% lines/branches/functions.

### End-to-end tests (Playwright)

Make sure the dev server is **not** already running — Playwright starts it automatically:

```bash
bunx playwright test
```

This runs 51 tests across 5 spec files:
- `marketing.spec.ts` — landing page sections
- `docs.spec.ts` — all 7 documentation pages
- `navigation.spec.ts` — authenticated routes and redirect guards
- `auth.spec.ts` — login and register forms

Open the Playwright UI for interactive debugging:

```bash
bunx playwright test --ui
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
| Runtime | Bun | 1.2 |
| Frontend | Next.js + React | 15 + 19 |
| Styling | Tailwind CSS + Radix UI | 3.4 |
| Documentation | Fumadocs | 14 |
| AI | AWS Bedrock + Vercel AI SDK | Claude Sonnet |
| Database | PostgreSQL + pgvector | 16 |
| ORM | Prisma | 6 |
| Auth | NextAuth.js + Cognito | 4.24 |
| Job Queue | pg-boss | 10 |
| Monorepo | Nx | 21 |
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

---

## License

MIT — free to use, modify, and self-host.
