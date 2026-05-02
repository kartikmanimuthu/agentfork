# Chatbot

Open-source, multi-tenant AI chatbot platform powered by AWS Bedrock. Self-hosted, MIT licensed.

**GitHub:** [kartikmanimuthu/chatbot](https://github.com/kartikmanimuthu/chatbot)

---

## Features

| Feature | Description |
|---------|-------------|
| Multi-Tenant | Isolated organizations with tenant-scoped data |
| AWS Bedrock | Claude models via Vercel AI SDK with streaming |
| RAG Pipeline | pgvector embeddings for retrieval-augmented generation |
| RBAC | Owner, Admin, Member, Viewer roles with granular permissions |
| Audit Logs | Complete activity trail with filtering |
| Background Jobs | pg-boss workers for embeddings and conversation summaries |
| Cognito Auth | NextAuth with AWS Cognito SSO support |
| Conversation History | Persistent chat history with pagination |

---

## Prerequisites

- [Bun](https://bun.sh) 1.2+
- [Node.js](https://nodejs.org) 20+
- PostgreSQL 16+ with [pgvector](https://github.com/pgvector/pgvector) extension
- AWS account with Bedrock access (Claude models enabled in your region)

---

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/kartikmanimuthu/chatbot.git
cd chatbot
```

### 2. Install dependencies

```bash
bun install
```

### 3. Set up environment variables

```bash
cp apps/web-ui/.env.example apps/web-ui/.env.local
```

Edit `apps/web-ui/.env.local` with your values:

```env
# Database
DATABASE_URL="postgresql://postgres:password@localhost:5432/chatbot?schema=public"

# NextAuth
NEXTAUTH_SECRET="your-random-secret-here"
NEXTAUTH_URL="http://localhost:3001"

# AWS (for Bedrock)
AWS_REGION="ap-south-1"
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"

# Cognito SSO (optional)
# COGNITO_CLIENT_ID=""
# COGNITO_CLIENT_SECRET=""
# COGNITO_ISSUER=""
```

### 4. Set up the database

Start PostgreSQL and enable pgvector:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Run migrations:

```bash
bun run prepare
bunx prisma migrate deploy --schema=./prisma/schema.prisma
```

### 5. Start the development server

```bash
cd apps/web-ui && bun run dev
```

Visit:
- **Marketing page:** http://localhost:3001
- **Docs:** http://localhost:3001/docs
- **App:** http://localhost:3001/chat (after signing up)

### 6. Start background workers (optional)

In a separate terminal:

```bash
cd apps/workers && bun run dev
```

---

## Project Structure

```
chatbot/
├── apps/
│   ├── web-ui/          # Next.js 15 frontend + API routes
│   └── workers/         # pg-boss background job processor
├── libs/
│   ├── shared/          # Database, auth, RBAC, services
│   └── ai/              # AWS Bedrock client, chat, embeddings
├── prisma/              # Schema and migrations
├── infra/               # Pulumi AWS infrastructure
└── tests/
    └── e2e/             # Playwright end-to-end tests
```

---

## Running Tests

### Unit tests

```bash
# libs/shared (65 tests)
cd libs/shared && bunx vitest run

# libs/ai (13 tests)
cd libs/ai && bunx vitest run

# With coverage
cd libs/shared && bunx vitest run --coverage
cd libs/ai && bunx vitest run --coverage
```

### End-to-end tests (Playwright)

Make sure the dev server is NOT already running (Playwright starts it automatically):

```bash
bunx playwright test
```

Run with UI:

```bash
bunx playwright test --ui
```

---

## Documentation

Full documentation is available at http://localhost:3001/docs when running locally, covering:

- [Getting Started](http://localhost:3001/docs/getting-started)
- [Installation](http://localhost:3001/docs/installation)
- [Configuration](http://localhost:3001/docs/configuration)
- [API Reference](http://localhost:3001/docs/api-reference)
- [Architecture](http://localhost:3001/docs/architecture)
- [FAQ](http://localhost:3001/docs/faq)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun 1.2 |
| Frontend | Next.js 15, React 19 |
| Styling | Tailwind CSS, Radix UI |
| Docs | Fumadocs |
| AI | AWS Bedrock (Claude), Vercel AI SDK |
| Database | PostgreSQL 16 + pgvector, Prisma 6 |
| Auth | NextAuth.js + AWS Cognito |
| Jobs | pg-boss |
| Monorepo | Nx |
| Testing | Vitest (unit), Playwright (e2e) |
| Infrastructure | Pulumi (AWS) |

---

## License

MIT — free to use, modify, and self-host.
