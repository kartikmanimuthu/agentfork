# Docs, Marketing & Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a marketing landing page, Fumadocs documentation site, Playwright e2e tests, and Vitest unit tests to the chatbot monorepo.

**Architecture:** All integrated into `apps/web-ui` using Next.js route groups. Marketing page at `/`, docs at `/docs/*`, existing app at `/(dashboard)/*`. Playwright at root, unit tests co-located with source.

**Tech Stack:** Next.js 15, React 19, Fumadocs (core + mdx + ui + openapi), Playwright, Vitest, Tailwind CSS, Bun

---

## File Structure

### New files
```
apps/web-ui/
├── source.config.ts                              # Fumadocs MDX config
├── lib/docs-source.ts                            # Fumadocs loader
├── content/docs/
│   ├── meta.json                                 # Sidebar nav order
│   ├── index.mdx                                 # Docs home
│   ├── getting-started.mdx                       # Setup guide
│   ├── installation.mdx                          # Deployment
│   ├── configuration.mdx                         # Env vars, services
│   ├── api-reference.mdx                         # OpenAPI docs
│   ├── architecture.mdx                          # System design
│   └── faq.mdx                                   # FAQ
├── content/docs/openapi.json                     # OpenAPI spec
├── app/(docs)/
│   ├── layout.tsx                                # RootProvider
│   └── docs/[[...slug]]/
│       ├── layout.tsx                            # DocsLayout + sidebar
│       └── page.tsx                              # Dynamic MDX renderer

playwright.config.ts                              # Playwright config
tests/e2e/
├── auth.setup.ts                                 # NextAuth session mint
├── marketing.spec.ts                             # Landing page tests
├── docs.spec.ts                                  # Docs page tests
├── navigation.spec.ts                            # Auth'd route tests
└── auth.spec.ts                                  # Login/register tests

libs/shared/src/
├── db/repositories/conversation/postgres.test.ts
├── db/repositories/message/postgres.test.ts
├── db/repositories/audit-log/postgres.test.ts
├── db/tenant-middleware.test.ts
├── auth/auth-session.test.ts
├── rbac/permissions.test.ts
├── rbac/authorize.test.ts
├── services/audit-service.test.ts
├── services/conversation-service.test.ts
├── services/message-service.test.ts
└── services/tenant-config-service.test.ts

libs/ai/src/
├── bedrock-client.test.ts
├── chat-completion.test.ts
└── embeddings.test.ts
```

### Modified files
```
apps/web-ui/next.config.ts          # Wrap with createMDX()
apps/web-ui/app/page.tsx            # Replace redirect with marketing page
apps/web-ui/package.json            # Add fumadocs deps
apps/web-ui/app/globals.css         # Add fumadocs CSS import
package.json                        # Add playwright, e2e scripts
nx.json                             # Add e2e target
libs/shared/vitest.config.ts        # Add coverage thresholds
libs/ai/vitest.config.ts            # Add coverage thresholds
.gitignore                          # Add test artifacts
```

---

## Task 1: Install Dependencies & Configure Build

**Files:**
- Modify: `apps/web-ui/package.json`
- Modify: `apps/web-ui/next.config.ts`
- Modify: `apps/web-ui/app/globals.css`
- Modify: `package.json`
- Modify: `nx.json`
- Modify: `.gitignore`

- [ ] **Step 1: Install fumadocs packages in web-ui**

```bash
cd apps/web-ui && bun add fumadocs-core fumadocs-mdx fumadocs-ui fumadocs-openapi
```

- [ ] **Step 2: Install Playwright at root**

```bash
bun add -d @playwright/test && bunx playwright install chromium
```

- [ ] **Step 3: Update next.config.ts to wrap with fumadocs MDX**

Replace `apps/web-ui/next.config.ts` with:

```ts
import type { NextConfig } from 'next';
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@chatbot/shared', '@chatbot/ai'],
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
};

export default withMDX(nextConfig);
```

- [ ] **Step 4: Add fumadocs CSS import to globals.css**

Add at the top of `apps/web-ui/app/globals.css`, before the `@tailwind` directives:

```css
@import 'fumadocs-ui/style.css';
```

- [ ] **Step 5: Add e2e target to nx.json**

Add `"e2e"` to `targetDefaults` in `nx.json`:

```json
"e2e": {
  "cache": true,
  "inputs": ["default", "^production"]
}
```

- [ ] **Step 6: Add e2e scripts to root package.json**

Add to `scripts` in root `package.json`:

```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui"
```

- [ ] **Step 7: Update .gitignore**

Append to `.gitignore`:

```
tests/e2e/.auth/
.superpowers/
playwright-report/
test-results/
.source/
```

- [ ] **Step 8: Verify build still works**

```bash
cd apps/web-ui && bun run build
```

Expected: Build succeeds (fumadocs MDX wrapper is a no-op without content).

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "chore: install fumadocs, playwright, and configure build pipeline"
```

---

## Task 2: Fumadocs Configuration & Route Structure

**Files:**
- Create: `apps/web-ui/source.config.ts`
- Create: `apps/web-ui/lib/docs-source.ts`
- Create: `apps/web-ui/app/(docs)/layout.tsx`
- Create: `apps/web-ui/app/(docs)/docs/[[...slug]]/layout.tsx`
- Create: `apps/web-ui/app/(docs)/docs/[[...slug]]/page.tsx`

- [ ] **Step 1: Create source.config.ts**

Create `apps/web-ui/source.config.ts`:

```ts
import { defineDocs, defineConfig } from "fumadocs-mdx/config";

export const { docs, meta } = defineDocs({
  dir: "content/docs",
});

export default defineConfig();
```

- [ ] **Step 2: Create lib/docs-source.ts**

Create `apps/web-ui/lib/docs-source.ts`:

```ts
import { loader } from "fumadocs-core/source";
import { createMDXSource } from "fumadocs-mdx";
import { docs, meta } from "@/.source";

export const source = loader({
  baseUrl: "/docs",
  source: createMDXSource(docs, meta),
});
```

- [ ] **Step 3: Create (docs) route group layout**

Create `apps/web-ui/app/(docs)/layout.tsx`:

```tsx
import { RootProvider } from "fumadocs-ui/provider";
import type { ReactNode } from "react";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <RootProvider>
      {children}
    </RootProvider>
  );
}
```

- [ ] **Step 4: Create docs slug layout with sidebar**

Create `apps/web-ui/app/(docs)/docs/[[...slug]]/layout.tsx`:

```tsx
import { source } from "@/lib/docs-source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { MessageSquare } from "lucide-react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: (
          <span className="flex items-center gap-2 font-bold">
            <MessageSquare className="w-4 h-4 text-primary" />
            Chatbot
          </span>
        ),
        url: "/",
      }}
      links={[
        { text: "Home", url: "/" },
        { text: "Chat", url: "/chat" },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
```

- [ ] **Step 5: Create docs slug page**

Create `apps/web-ui/app/(docs)/docs/[[...slug]]/page.tsx`:

```tsx
import { source } from "@/lib/docs-source";
import { DocsPage, DocsBody, DocsTitle, DocsDescription } from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import defaultMdxComponents from "fumadocs-ui/mdx";

export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={defaultMdxComponents} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  return { title: page.data.title, description: page.data.description };
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web-ui/source.config.ts apps/web-ui/lib/docs-source.ts apps/web-ui/app/\(docs\)/ && git commit -m "feat: add fumadocs route structure and configuration"
```

---

## Task 3: Documentation Content (MDX Pages)

**Files:**
- Create: `apps/web-ui/content/docs/meta.json`
- Create: `apps/web-ui/content/docs/index.mdx`
- Create: `apps/web-ui/content/docs/getting-started.mdx`
- Create: `apps/web-ui/content/docs/installation.mdx`
- Create: `apps/web-ui/content/docs/configuration.mdx`
- Create: `apps/web-ui/content/docs/api-reference.mdx`
- Create: `apps/web-ui/content/docs/architecture.mdx`
- Create: `apps/web-ui/content/docs/faq.mdx`
- Create: `apps/web-ui/content/docs/openapi.json`

- [ ] **Step 1: Create meta.json**

Create `apps/web-ui/content/docs/meta.json`:

```json
{
  "title": "Documentation",
  "pages": [
    "index",
    "getting-started",
    "installation",
    "configuration",
    "api-reference",
    "architecture",
    "faq"
  ]
}
```

- [ ] **Step 2: Create index.mdx**

Create `apps/web-ui/content/docs/index.mdx`:

```mdx
---
title: Chatbot Documentation
description: Open-source, multi-tenant AI chatbot platform powered by AWS Bedrock. Self-hosted, MIT licensed.
---

Chatbot is an open-source AI chatbot platform with multi-tenant isolation, RBAC, audit logging, and RAG support. Built on Next.js 15, AWS Bedrock, and PostgreSQL with pgvector.

## Features

| Feature | Description |
|---------|-------------|
| Multi-Tenant | Isolated organizations with tenant-scoped data |
| AWS Bedrock | Claude models via Vercel AI SDK |
| RAG Pipeline | pgvector embeddings for retrieval-augmented generation |
| RBAC | Role-based access control (Owner, Admin, Member, Viewer) |
| Audit Logs | Complete activity trail with filtering |
| Background Jobs | pg-boss workers for embeddings and summaries |
| Auth | NextAuth with Cognito SSO support |
| Conversations | Persistent chat history with search |

## Quick Links

- [Getting Started](/docs/getting-started) — Set up your first instance in 5 minutes
- [Installation](/docs/installation) — Deploy with Docker or Pulumi
- [Configuration](/docs/configuration) — Configure Bedrock, Cognito, and pgvector
- [API Reference](/docs/api-reference) — REST API endpoints
- [Architecture](/docs/architecture) — System design and data flow
- [FAQ](/docs/faq) — Frequently asked questions
```

- [ ] **Step 3: Create getting-started.mdx**

Create `apps/web-ui/content/docs/getting-started.mdx`:

```mdx
---
title: Getting Started
description: Set up your Chatbot instance in 5 minutes.
---

## Prerequisites

- Node.js 20+ or Bun 1.2+
- PostgreSQL 16 with pgvector extension
- AWS account with Bedrock access (Claude models enabled)

## Step 1: Clone and Install

```bash
git clone https://github.com/kartikmanimuthu/chatbot.git
cd chatbot
bun install
```

## Step 2: Configure Environment

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Key variables:
- `DATABASE_URL` — PostgreSQL connection string
- `AWS_REGION` — AWS region with Bedrock access
- `NEXTAUTH_SECRET` — Random secret for session encryption
- `NEXTAUTH_URL` — Your app URL (e.g., `http://localhost:3001`)

## Step 3: Set Up the Database

```bash
bun run prepare
npx prisma migrate deploy
```

## Step 4: Start Development

```bash
cd apps/web-ui && bun run dev
```

Visit `http://localhost:3001` to see the landing page. Sign up to create your first organization.

## Next Steps

- [Configure AWS Bedrock models](/docs/configuration#aws-bedrock)
- [Set up Cognito SSO](/docs/configuration#cognito-sso)
- [Deploy to production](/docs/installation)
```

- [ ] **Step 4: Create installation.mdx**

Create `apps/web-ui/content/docs/installation.mdx`:

```mdx
---
title: Installation
description: Deploy Chatbot to your infrastructure using Docker or Pulumi.
---

## Docker

Multi-stage Dockerfiles are provided for both the web UI and workers.

### Web UI

```bash
docker build -f apps/web-ui/Dockerfile -t chatbot-web .
docker run -p 3001:3001 --env-file .env chatbot-web
```

### Workers

```bash
docker build -f apps/workers/Dockerfile -t chatbot-workers .
docker run --env-file .env chatbot-workers
```

## Pulumi (AWS)

The `infra/` directory contains Pulumi stacks for AWS deployment:

```bash
cd infra
bun install
pulumi up
```

This deploys:
- ECS Fargate services for web-ui and workers
- RDS PostgreSQL with pgvector
- Application Load Balancer
- VPC networking

## Manual Deployment

### Build

```bash
bun install
bun run prepare
cd apps/web-ui && bun run build
cd ../workers && bun run build
```

### Run

```bash
# Web UI (standalone Next.js)
node apps/web-ui/.next/standalone/server.js

# Workers
node --env-file=.env apps/workers/dist/index.js
```

## Environment Variables

See [Configuration](/docs/configuration) for the full list of environment variables.
```

- [ ] **Step 5: Create configuration.mdx**

Create `apps/web-ui/content/docs/configuration.mdx`:

```mdx
---
title: Configuration
description: Configure AWS Bedrock, Cognito, database, and application settings.
---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string with pgvector |
| `AWS_REGION` | Yes | AWS region (e.g., `ap-south-1`) |
| `NEXTAUTH_SECRET` | Yes | Random secret for session JWT encryption |
| `NEXTAUTH_URL` | Yes | Application URL (e.g., `http://localhost:3001`) |
| `COGNITO_CLIENT_ID` | No | AWS Cognito app client ID for SSO |
| `COGNITO_CLIENT_SECRET` | No | AWS Cognito app client secret |
| `COGNITO_ISSUER` | No | Cognito issuer URL |

## AWS Bedrock

The platform uses AWS Bedrock for AI model access. The default model is `anthropic.claude-sonnet-4-20250514`.

Ensure your AWS credentials have access to:
- `bedrock:InvokeModel`
- `bedrock:InvokeModelWithResponseStream`

The embedding model is `amazon.titan-embed-text-v2:0` for RAG vector generation.

## Cognito SSO

To enable SSO login via AWS Cognito:

1. Create a Cognito User Pool
2. Create an App Client with authorization code grant
3. Set the callback URL to `{NEXTAUTH_URL}/api/auth/callback/cognito`
4. Set `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET`, and `COGNITO_ISSUER`

## Database

PostgreSQL 16+ with the `pgvector` extension is required:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Run migrations:

```bash
npx prisma migrate deploy
```

## RBAC

Four predefined roles control access:

| Role | Chat | Conversations | Settings |
|------|------|---------------|----------|
| Owner | CRUD | CRUD | CRUD |
| Admin | CRUD | CRUD | CRU |
| Member | CR | CR | R |
| Viewer | R | R | R |
```

- [ ] **Step 6: Create api-reference.mdx**

Create `apps/web-ui/content/docs/api-reference.mdx`:

```mdx
---
title: API Reference
description: REST API endpoints for the Chatbot platform.
---

## Authentication

All API endpoints (except `/api/health` and `/api/auth/*`) require a valid NextAuth session cookie.

## Endpoints

### POST /api/chat

Stream a chat completion response.

**Request body:**
```json
{
  "messages": [{ "role": "user", "content": "Hello" }],
  "conversationId": "optional-id",
  "model": "anthropic.claude-sonnet-4-20250514"
}
```

**Response:** Server-sent events stream with AI response chunks.

### GET /api/conversations

List conversations for the authenticated user.

**Query params:** `limit` (default 20), `offset` (default 0)

**Response:**
```json
{
  "items": [{ "id": "...", "title": "...", "status": "active", "messageCount": 5 }],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

### POST /api/conversations

Create a new conversation.

**Request body:**
```json
{ "title": "My Chat", "model": "anthropic.claude-sonnet-4-20250514" }
```

### GET /api/conversations/[id]

Get a single conversation by ID.

### GET /api/messages

List messages for a conversation.

**Query params:** `conversationId` (required), `limit` (default 50)

### POST /api/messages

Create a message in a conversation.

**Request body:**
```json
{ "conversationId": "...", "role": "user", "content": "Hello" }
```

### GET /api/health

Health check endpoint. No authentication required.

**Response:** `{ "status": "ok" }`

### GET /api/audit

Query audit logs with optional filters.

**Query params:** `eventType`, `severity`, `startDate`, `endDate`, `limit`, `offset`

### GET /api/tenants

Get current tenant information.

### POST /api/invitations

Send a team invitation.

**Request body:**
```json
{ "email": "user@example.com", "role": "Member" }
```
```

- [ ] **Step 7: Create architecture.mdx**

Create `apps/web-ui/content/docs/architecture.mdx`:

```mdx
---
title: Architecture
description: System design, monorepo structure, and data flow.
---

## Monorepo Structure

```
chatbot/
├── apps/
│   ├── web-ui/          # Next.js 15 frontend + API routes
│   └── workers/         # pg-boss background job processor
├── libs/
│   ├── shared/          # Database, auth, RBAC, services
│   └── ai/              # AWS Bedrock client, chat, embeddings
├── prisma/              # Schema and migrations
└── infra/               # Pulumi AWS infrastructure
```

## Data Flow

1. User sends a message via the chat UI
2. `POST /api/chat` receives the request, validates the session
3. `streamChat()` from `@chatbot/ai` calls AWS Bedrock via the AI SDK
4. Response streams back to the client via server-sent events
5. Message is persisted via `@chatbot/shared` repositories
6. pg-boss job is enqueued for embedding generation
7. Workers pick up the job and call `generateEmbedding()` from `@chatbot/ai`
8. Embedding is stored in PostgreSQL via pgvector

## Multi-Tenant Isolation

All database queries pass through `getTenantClient()` which uses Prisma client extensions to automatically inject `tenantId` into every query for tenant-scoped models (Conversation, AuditLog, CustomRole, UserTenantRole, TenantConfig, Invitation).

## Technology Choices

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | Bun | Fast package management and script execution |
| Frontend | Next.js 15 + React 19 | App Router, server components, streaming |
| AI | AWS Bedrock + AI SDK | Managed Claude models, streaming support |
| Database | PostgreSQL + pgvector | Relational data + vector embeddings |
| Auth | NextAuth + Cognito | Flexible auth with enterprise SSO |
| Jobs | pg-boss | PostgreSQL-native job queue, no Redis needed |
| Monorepo | Nx | Task orchestration, caching, dependency graph |
```

- [ ] **Step 8: Create faq.mdx**

Create `apps/web-ui/content/docs/faq.mdx`:

```mdx
---
title: FAQ
description: Frequently asked questions about the Chatbot platform.
---

## Is this really free?

Yes. Chatbot is MIT licensed and free to self-host. You pay only for your own AWS infrastructure (Bedrock API calls, RDS, ECS).

## Which AI models are supported?

Any model available through AWS Bedrock. The default is Claude Sonnet (`anthropic.claude-sonnet-4-20250514`). You can configure the model per conversation.

## Do I need pgvector?

Yes, if you want RAG (retrieval-augmented generation) support. The embedding pipeline stores vectors in PostgreSQL using the pgvector extension. Without it, basic chat still works but semantic search is disabled.

## Can I use this without AWS?

The AI layer is built on the Vercel AI SDK, which supports multiple providers. However, the current implementation is configured for AWS Bedrock. Swapping providers would require modifying `libs/ai/src/bedrock-client.ts`.

## How does multi-tenancy work?

Each organization is a tenant. A Prisma client extension automatically scopes all database queries to the current tenant's ID. Users belong to tenants via roles (Owner, Admin, Member, Viewer).

## How do I add SSO?

Configure AWS Cognito environment variables (`COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET`, `COGNITO_ISSUER`). See [Configuration](/docs/configuration#cognito-sso).
```

- [ ] **Step 9: Create openapi.json**

Create `apps/web-ui/content/docs/openapi.json`:

```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "Chatbot API",
    "version": "1.0.0",
    "description": "REST API for the Chatbot platform"
  },
  "servers": [{ "url": "http://localhost:3001" }],
  "paths": {
    "/api/health": {
      "get": {
        "summary": "Health check",
        "responses": {
          "200": {
            "description": "OK",
            "content": { "application/json": { "schema": { "type": "object", "properties": { "status": { "type": "string", "example": "ok" } } } } }
          }
        }
      }
    },
    "/api/chat": {
      "post": {
        "summary": "Stream chat completion",
        "security": [{ "session": [] }],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["messages"],
                "properties": {
                  "messages": { "type": "array", "items": { "type": "object", "properties": { "role": { "type": "string" }, "content": { "type": "string" } } } },
                  "conversationId": { "type": "string" },
                  "model": { "type": "string" }
                }
              }
            }
          }
        },
        "responses": { "200": { "description": "SSE stream" } }
      }
    },
    "/api/conversations": {
      "get": {
        "summary": "List conversations",
        "security": [{ "session": [] }],
        "parameters": [
          { "name": "limit", "in": "query", "schema": { "type": "integer", "default": 20 } },
          { "name": "offset", "in": "query", "schema": { "type": "integer", "default": 0 } }
        ],
        "responses": { "200": { "description": "Paginated conversation list" } }
      },
      "post": {
        "summary": "Create conversation",
        "security": [{ "session": [] }],
        "requestBody": {
          "content": { "application/json": { "schema": { "type": "object", "properties": { "title": { "type": "string" }, "model": { "type": "string" } } } } }
        },
        "responses": { "201": { "description": "Created" } }
      }
    },
    "/api/messages": {
      "get": {
        "summary": "List messages",
        "security": [{ "session": [] }],
        "parameters": [
          { "name": "conversationId", "in": "query", "required": true, "schema": { "type": "string" } },
          { "name": "limit", "in": "query", "schema": { "type": "integer", "default": 50 } }
        ],
        "responses": { "200": { "description": "Message list" } }
      }
    },
    "/api/audit": {
      "get": {
        "summary": "Query audit logs",
        "security": [{ "session": [] }],
        "parameters": [
          { "name": "eventType", "in": "query", "schema": { "type": "string" } },
          { "name": "severity", "in": "query", "schema": { "type": "string" } }
        ],
        "responses": { "200": { "description": "Paginated audit logs" } }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "session": { "type": "apiKey", "in": "cookie", "name": "next-auth.session-token" }
    }
  }
}
```

- [ ] **Step 10: Verify docs build**

```bash
cd apps/web-ui && bun run build
```

Expected: Build succeeds, docs pages are generated.

- [ ] **Step 11: Commit**

```bash
git add apps/web-ui/content/ && git commit -m "feat: add documentation content — 7 MDX pages and OpenAPI spec"
```

---

## Task 4: Marketing Landing Page

**Files:**
- Modify: `apps/web-ui/app/page.tsx`

- [ ] **Step 1: Replace the redirect with the marketing landing page**

Replace `apps/web-ui/app/page.tsx` entirely with:

```tsx
import Link from 'next/link';
import { MessageSquare, Shield, Users, Database, Bot, FileText, Clock, History, KeyRound, Github } from 'lucide-react';

const features = [
  { icon: Users, title: 'Multi-Tenant', description: 'Isolated organizations with tenant-scoped data and separate configurations.' },
  { icon: Bot, title: 'AWS Bedrock', description: 'Claude models via Vercel AI SDK with streaming chat completions.' },
  { icon: Database, title: 'RAG Pipeline', description: 'pgvector embeddings for retrieval-augmented generation over your data.' },
  { icon: Shield, title: 'RBAC & Security', description: 'Four predefined roles — Owner, Admin, Member, Viewer — with granular permissions.' },
  { icon: FileText, title: 'Audit Logs', description: 'Complete activity trail with filtering by event type, severity, and date range.' },
  { icon: Clock, title: 'Background Jobs', description: 'pg-boss workers handle embedding generation and conversation summaries.' },
  { icon: KeyRound, title: 'Cognito Auth', description: 'NextAuth with AWS Cognito SSO support and credentials-based login.' },
  { icon: History, title: 'Conversation History', description: 'Persistent chat history with pagination, search, and model selection.' },
];

const stats = [
  { value: '100%', label: 'Free & open source' },
  { value: 'Multi', label: 'Tenant isolation' },
  { value: 'RBAC', label: 'Built-in roles' },
  { value: 'MIT', label: 'Licensed' },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b" role="navigation">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold">Chatbot</span>
          <div className="flex items-center gap-6 text-sm">
            <a href="#features" className="text-muted-foreground hover:text-foreground">Features</a>
            <a href="https://github.com/kartikmanimuthu/chatbot" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
              <Github className="h-4 w-4" />
              <span className="sr-only">GitHub</span>
            </a>
            <Link href="/docs" className="text-muted-foreground hover:text-foreground">Docs</Link>
            <Link href="/login" className="text-muted-foreground hover:text-foreground">Sign in</Link>
            <Link href="/register" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Get Started</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <span className="inline-block rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">Open Source · MIT License</span>
        <h1 className="mt-6 text-5xl font-extrabold tracking-tight">AI Chatbot Platform</h1>
        <p className="mt-4 text-lg text-muted-foreground">Self-hosted, multi-tenant chatbot powered by AWS Bedrock. Deploy for free, keep full control of your data.</p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/register" className="rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">Deploy Free</Link>
          <a href="https://github.com/kartikmanimuthu/chatbot" target="_blank" rel="noopener noreferrer" className="rounded-md border px-6 py-3 text-sm font-medium hover:bg-secondary">View on GitHub</a>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y bg-secondary/30">
        <div className="mx-auto flex max-w-4xl items-center justify-around px-6 py-6">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="text-center text-3xl font-bold">Everything you need for AI chat</h2>
        <p className="mt-2 text-center text-muted-foreground">Enterprise-grade features, zero license cost.</p>
        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="rounded-lg border p-6">
              <f.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t bg-secondary/30 px-6 py-24">
        <h2 className="text-center text-3xl font-bold">Free forever</h2>
        <p className="mt-2 text-center text-muted-foreground">Self-host and own your data. No usage limits, no vendor lock-in.</p>
        <div className="mx-auto mt-12 grid max-w-4xl gap-6 sm:grid-cols-3">
          <div className="rounded-lg border bg-white p-6">
            <h3 className="font-semibold">Self-Hosted</h3>
            <div className="mt-2 text-3xl font-bold">$0</div>
            <p className="text-sm text-muted-foreground">forever</p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>All features included</li>
              <li>Unlimited users</li>
              <li>Community support</li>
            </ul>
            <a href="https://github.com/kartikmanimuthu/chatbot" className="mt-6 block rounded-md border px-4 py-2 text-center text-sm font-medium hover:bg-secondary">Deploy Now</a>
          </div>
          <div className="rounded-lg border bg-white p-6 opacity-60">
            <h3 className="font-semibold">Cloud Hosted</h3>
            <div className="mt-2 text-lg font-bold text-muted-foreground">Coming soon</div>
            <p className="text-sm text-muted-foreground">Managed hosting</p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>Zero infrastructure</li>
              <li>Automatic updates</li>
              <li>Priority support</li>
            </ul>
          </div>
          <div className="rounded-lg border bg-white p-6 opacity-60">
            <h3 className="font-semibold">Enterprise</h3>
            <div className="mt-2 text-lg font-bold text-muted-foreground">Custom</div>
            <p className="text-sm text-muted-foreground">Dedicated support</p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>SLA guarantees</li>
              <li>Custom integrations</li>
              <li>On-premise option</li>
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h2 className="text-3xl font-bold">Ready to deploy your AI chatbot?</h2>
        <p className="mt-2 text-muted-foreground">Get started in under 5 minutes. Free, open source, and self-hosted.</p>
        <Link href="/register" className="mt-6 inline-block rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">Get started free</Link>
      </section>

      {/* Footer */}
      <footer className="border-t" role="contentinfo">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-sm text-muted-foreground">
          <span>Chatbot · MIT License</span>
          <div className="flex gap-4">
            <Link href="/docs">Docs</Link>
            <Link href="/docs/getting-started">Getting Started</Link>
            <a href="https://github.com/kartikmanimuthu/chatbot" target="_blank" rel="noopener noreferrer">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
```

- [ ] **Step 2: Verify the page renders**

```bash
cd apps/web-ui && bun run dev
```

Open `http://localhost:3001` — should show the marketing landing page instead of redirecting to `/chat`.

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/app/page.tsx && git commit -m "feat: add marketing landing page with features, pricing, and CTA"
```

---

## Task 5: Playwright E2E — Config & Auth Setup

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/auth.setup.ts`

- [ ] **Step 1: Create playwright.config.ts**

Create `playwright.config.ts` at the repo root:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html'], ['list']],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/.auth/session.json',
      },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
  ],

  webServer: {
    command: 'cd apps/web-ui && bun run dev',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 2: Create auth.setup.ts**

Create `tests/e2e/auth.setup.ts`:

```ts
import { test as setup, expect } from '@playwright/test';
import path from 'path';

export const STORAGE_STATE = path.resolve(__dirname, '.auth/session.json');

setup.setTimeout(90000);
setup('create authenticated session', async ({ page }) => {
  const { execSync } = await import('child_process');

  const secret = process.env.NEXTAUTH_SECRET ?? 'chatbot-nextauth-secret-change-in-production';

  const tokenJson = execSync(
    `node -e "
const { encode } = require('${path.resolve(__dirname, '../../apps/web-ui/node_modules/next-auth/jwt')}');
encode({
    token: {
        name: 'Test User',
        email: 'test@example.com',
        sub: 'test-user-id',
        tenantId: 'test-tenant-id',
        role: 'Owner',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
    },
    secret: '${secret}',
}).then(t => process.stdout.write(t));
"`
  ).toString().trim();

  await page.context().addCookies([
    {
      name: 'next-auth.session-token',
      value: tokenJson,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 86400,
    },
  ]);

  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await expect(page).not.toHaveURL(/login/);

  await page.context().storageState({ path: STORAGE_STATE });
});
```

- [ ] **Step 3: Create .auth directory**

```bash
mkdir -p tests/e2e/.auth
```

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/e2e/auth.setup.ts && git commit -m "feat: add Playwright config and auth setup"
```

---

## Task 6: Playwright E2E — Marketing & Docs Specs

**Files:**
- Create: `tests/e2e/marketing.spec.ts`
- Create: `tests/e2e/docs.spec.ts`

- [ ] **Step 1: Create marketing.spec.ts**

Create `tests/e2e/marketing.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Marketing — Navigation Bar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('brand name is visible', async ({ page }) => {
    await expect(page.getByRole('navigation').getByText('Chatbot')).toBeVisible();
  });

  test('nav links Features and Docs are present', async ({ page }) => {
    const nav = page.getByRole('navigation');
    await expect(nav.getByText('Features')).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Docs' })).toBeVisible();
  });

  test('Sign in and Get Started buttons are present', async ({ page }) => {
    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Get Started' })).toBeVisible();
  });

  test('Sign in link navigates to /login', async ({ page }) => {
    await page.getByRole('navigation').getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('Docs link navigates to /docs', async ({ page }) => {
    await page.getByRole('navigation').getByRole('link', { name: 'Docs' }).click();
    await expect(page).toHaveURL(/\/docs/);
  });
});

test.describe('Marketing — Hero Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('hero headline is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /AI Chatbot Platform/i })).toBeVisible();
  });

  test('open source badge is visible', async ({ page }) => {
    await expect(page.getByText('Open Source · MIT License')).toBeVisible();
  });

  test('hero subtitle is present', async ({ page }) => {
    await expect(page.getByText(/Self-hosted, multi-tenant/i)).toBeVisible();
  });

  test('Deploy Free CTA navigates to /register', async ({ page }) => {
    await page.getByRole('link', { name: /Deploy Free/i }).click();
    await expect(page).toHaveURL(/\/register/);
  });

  test('View on GitHub link is present', async ({ page }) => {
    await expect(page.getByRole('link', { name: /View on GitHub/i })).toBeVisible();
  });
});

test.describe('Marketing — Features Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('features heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Everything you need for AI chat/i })).toBeVisible();
  });

  const featureCards = [
    'Multi-Tenant', 'AWS Bedrock', 'RAG Pipeline', 'RBAC & Security',
    'Audit Logs', 'Background Jobs', 'Cognito Auth', 'Conversation History',
  ];

  for (const feature of featureCards) {
    test(`feature card "${feature}" is visible`, async ({ page }) => {
      await expect(page.getByRole('heading', { name: feature, level: 3 })).toBeVisible();
    });
  }
});

test.describe('Marketing — Pricing Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('pricing heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Free forever/i })).toBeVisible();
  });

  test('three pricing plans are visible', async ({ page }) => {
    await expect(page.getByText('Self-Hosted').first()).toBeVisible();
    await expect(page.getByText('Cloud Hosted').first()).toBeVisible();
    await expect(page.getByText('Enterprise').first()).toBeVisible();
  });

  test('Self-Hosted plan shows $0', async ({ page }) => {
    await expect(page.getByText('$0')).toBeVisible();
  });

  test('Deploy Now links to GitHub', async ({ page }) => {
    const deployBtn = page.getByRole('link', { name: 'Deploy Now' });
    await expect(deployBtn).toBeVisible();
    const href = await deployBtn.getAttribute('href');
    expect(href).toContain('github.com');
  });
});

test.describe('Marketing — CTA & Footer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('CTA headline is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Ready to deploy/i })).toBeVisible();
  });

  test('Get started free CTA navigates to /register', async ({ page }) => {
    const cta = page.getByRole('link', { name: /Get started free/i });
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(/\/register/);
  });

  test('footer brand and license visible', async ({ page }) => {
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByText('Chatbot').first()).toBeVisible();
    await expect(footer.getByText(/MIT License/).first()).toBeVisible();
  });

  test('footer Docs link is present', async ({ page }) => {
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByRole('link', { name: 'Docs' })).toBeVisible();
  });

  test('footer Getting Started link is present', async ({ page }) => {
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByRole('link', { name: 'Getting Started' })).toBeVisible();
  });
});
```

- [ ] **Step 2: Create docs.spec.ts**

Create `tests/e2e/docs.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function gotoDoc(page: any, path: string) {
  const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(res?.status(), `${path} returned HTTP ${res?.status()}`).not.toBe(404);
}

test.describe('Docs — Root (/docs)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDoc(page, '/docs');
  });

  test('page loads without 404', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/404|This page could not be found/i);
  });

  test('docs title heading is visible', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /Chatbot Documentation/i })
    ).toBeVisible({ timeout: 10000 });
  });

  test('features table is present', async ({ page }) => {
    await expect(page.locator('table td', { hasText: 'Multi-Tenant' }).first()).toBeVisible();
    await expect(page.locator('table td', { hasText: 'AWS Bedrock' }).first()).toBeVisible();
    await expect(page.locator('table td', { hasText: 'RAG Pipeline' }).first()).toBeVisible();
  });

  test('quick links section is present', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Quick Links/ }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Getting Started' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Installation' }).first()).toBeVisible();
  });

  test('sidebar navigation is rendered', async ({ page }) => {
    await expect(page.getByRole('link', { name: /Getting Started/i }).first()).toBeVisible();
  });
});

test.describe('Docs — Getting Started', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDoc(page, '/docs/getting-started');
  });

  test('page loads without 404', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/404|This page could not be found/i);
  });

  test('heading is visible', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /Getting Started/i })
    ).toBeVisible({ timeout: 10000 });
  });

  test('prerequisites section is present', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Prerequisites/i })).toBeVisible();
  });
});

test.describe('Docs — Installation', () => {
  test('page loads and heading visible', async ({ page }) => {
    await gotoDoc(page, '/docs/installation');
    await expect(
      page.getByRole('heading', { name: /Installation/i })
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Docs — Configuration', () => {
  test('page loads and heading visible', async ({ page }) => {
    await gotoDoc(page, '/docs/configuration');
    await expect(
      page.getByRole('heading', { name: 'Configuration', exact: true })
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Docs — API Reference', () => {
  test('page loads and heading visible', async ({ page }) => {
    await gotoDoc(page, '/docs/api-reference');
    await expect(
      page.getByRole('heading', { name: /API Reference/i })
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Docs — Architecture', () => {
  test('page loads and heading visible', async ({ page }) => {
    await gotoDoc(page, '/docs/architecture');
    await expect(
      page.getByRole('heading', { name: /Architecture/i })
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Docs — FAQ', () => {
  test('page loads and heading visible', async ({ page }) => {
    await gotoDoc(page, '/docs/faq');
    await expect(
      page.getByRole('heading', { name: /FAQ/i })
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Docs — Sidebar Links', () => {
  test('all sidebar doc links load without 404', async ({ page }) => {
    await gotoDoc(page, '/docs');

    const docLinks = [
      '/docs/getting-started',
      '/docs/installation',
      '/docs/configuration',
      '/docs/api-reference',
      '/docs/architecture',
      '/docs/faq',
    ];

    for (const link of docLinks) {
      const res = await page.goto(link, { waitUntil: 'domcontentloaded' });
      const status = res?.status() ?? 200;
      expect(status, `${link} returned HTTP ${status}`).not.toBe(404);
    }
  });
});
```

- [ ] **Step 3: Run the specs to verify**

```bash
bunx playwright test tests/e2e/marketing.spec.ts tests/e2e/docs.spec.ts
```

Expected: All tests pass (marketing page and docs pages render correctly).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/marketing.spec.ts tests/e2e/docs.spec.ts && git commit -m "test: add e2e specs for marketing page and docs"
```

---

## Task 7: Playwright E2E — Navigation & Auth Specs

**Files:**
- Create: `tests/e2e/navigation.spec.ts`
- Create: `tests/e2e/auth.spec.ts`

- [ ] **Step 1: Create navigation.spec.ts**

Create `tests/e2e/navigation.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('Navigation — Authenticated Routes', () => {
  test('chat page loads', async ({ page }) => {
    await page.goto('/chat', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/login/);
  });

  test('conversations page loads', async ({ page }) => {
    await page.goto('/conversations', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/login/);
  });

  test('settings page loads', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/login/);
  });
});

test.describe('Navigation — Unauthenticated Redirects', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('unauthenticated user visiting /chat is redirected to /login', async ({ page }) => {
    await page.goto('/chat', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
  });
});
```

- [ ] **Step 2: Create auth.spec.ts**

Create `tests/e2e/auth.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Auth — Login Page', () => {
  test('login page renders sign-in form', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Sign in/i })).toBeVisible();
    await expect(page.getByPlaceholder('Email')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign in$/i })).toBeVisible();
  });

  test('SSO button is present', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /SSO/i })).toBeVisible();
  });
});

test.describe('Auth — Register Page', () => {
  test('register page renders form', async ({ page }) => {
    await page.goto('/register', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Create account/i })).toBeVisible();
    await expect(page.getByPlaceholder('Name')).toBeVisible();
    await expect(page.getByPlaceholder('Email')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /Create account/i })).toBeVisible();
  });

  test('register page has link to login', async ({ page }) => {
    await page.goto('/register', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: /Sign in/i })).toBeVisible();
  });
});
```

- [ ] **Step 3: Run all e2e tests**

```bash
bunx playwright test
```

Expected: All specs pass — setup, marketing, docs, navigation, auth.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/navigation.spec.ts tests/e2e/auth.spec.ts && git commit -m "test: add e2e specs for navigation and auth flows"
```

---

## Task 8: Unit Tests — RBAC & Auth (libs/shared)

**Files:**
- Create: `libs/shared/src/rbac/permissions.test.ts`
- Create: `libs/shared/src/rbac/authorize.test.ts`
- Create: `libs/shared/src/auth/auth-session.test.ts`

- [ ] **Step 1: Create permissions.test.ts**

Create `libs/shared/src/rbac/permissions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hasPermission, hasCustomPermission, ROLE_PERMISSIONS, ROLE_LEVELS } from './permissions';
import type { PermissionSet } from './types';

describe('ROLE_PERMISSIONS', () => {
  it('defines all four roles', () => {
    expect(Object.keys(ROLE_PERMISSIONS)).toEqual(['Owner', 'Admin', 'Member', 'Viewer']);
  });

  it('Owner has full CRUD on all modules', () => {
    const owner = ROLE_PERMISSIONS.Owner;
    expect(owner.Chat).toEqual(['create', 'read', 'update', 'delete']);
    expect(owner.Conversations).toEqual(['create', 'read', 'update', 'delete']);
    expect(owner.Settings).toEqual(['create', 'read', 'update', 'delete']);
  });

  it('Viewer has read-only on all modules', () => {
    const viewer = ROLE_PERMISSIONS.Viewer;
    expect(viewer.Chat).toEqual(['read']);
    expect(viewer.Conversations).toEqual(['read']);
    expect(viewer.Settings).toEqual(['read']);
  });

  it('Admin cannot delete Settings', () => {
    expect(ROLE_PERMISSIONS.Admin.Settings).not.toContain('delete');
  });

  it('Member can create and read Chat but not update or delete', () => {
    expect(ROLE_PERMISSIONS.Member.Chat).toEqual(['create', 'read']);
  });
});

describe('ROLE_LEVELS', () => {
  it('Owner is highest level (4)', () => {
    expect(ROLE_LEVELS.Owner).toBe(4);
  });

  it('Viewer is lowest level (1)', () => {
    expect(ROLE_LEVELS.Viewer).toBe(1);
  });

  it('levels are ordered Owner > Admin > Member > Viewer', () => {
    expect(ROLE_LEVELS.Owner).toBeGreaterThan(ROLE_LEVELS.Admin);
    expect(ROLE_LEVELS.Admin).toBeGreaterThan(ROLE_LEVELS.Member);
    expect(ROLE_LEVELS.Member).toBeGreaterThan(ROLE_LEVELS.Viewer);
  });
});

describe('hasPermission', () => {
  it('returns true when role has the action on the module', () => {
    expect(hasPermission('Owner', 'delete', 'Settings')).toBe(true);
  });

  it('returns false when role lacks the action', () => {
    expect(hasPermission('Viewer', 'create', 'Chat')).toBe(false);
  });

  it('returns false for an unknown role', () => {
    expect(hasPermission('Unknown' as any, 'read', 'Chat')).toBe(false);
  });

  it('Member can read Settings but not update', () => {
    expect(hasPermission('Member', 'read', 'Settings')).toBe(true);
    expect(hasPermission('Member', 'update', 'Settings')).toBe(false);
  });
});

describe('hasCustomPermission', () => {
  it('returns true when custom set includes the action', () => {
    const custom: PermissionSet = { Chat: ['read'], Conversations: [], Settings: [] };
    expect(hasCustomPermission(custom, 'read', 'Chat')).toBe(true);
  });

  it('returns false when custom set lacks the action', () => {
    const custom: PermissionSet = { Chat: ['read'], Conversations: [], Settings: [] };
    expect(hasCustomPermission(custom, 'create', 'Chat')).toBe(false);
  });

  it('returns false for empty module actions', () => {
    const custom: PermissionSet = { Chat: [], Conversations: [], Settings: [] };
    expect(hasCustomPermission(custom, 'read', 'Chat')).toBe(false);
  });
});
```

- [ ] **Step 2: Run permissions tests**

```bash
cd libs/shared && bunx vitest run src/rbac/permissions.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Create authorize.test.ts**

Create `libs/shared/src/rbac/authorize.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: any, init: any) => ({ body, status: init?.status }),
  },
}));

import { getServerSession } from 'next-auth';
import { authorize } from './authorize';

const mockGetServerSession = vi.mocked(getServerSession);

describe('authorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no session exists', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const result = await authorize('read', 'Chat', {});
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it('returns null (allowed) for super admin', async () => {
    mockGetServerSession.mockResolvedValue({ user: { isSuperAdmin: true } } as any);
    const result = await authorize('delete', 'Settings', {});
    expect(result).toBeNull();
  });

  it('returns 403 when user has no role', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1' } } as any);
    const result = await authorize('read', 'Chat', {});
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('returns null when Owner reads Chat', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1', role: 'Owner' } } as any);
    const result = await authorize('read', 'Chat', {});
    expect(result).toBeNull();
  });

  it('returns 403 when Viewer tries to create Chat', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1', role: 'Viewer' } } as any);
    const result = await authorize('create', 'Chat', {});
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('maps subject type via SUBJECT_TO_MODULE', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1', role: 'Owner' } } as any);
    const result = await authorize('read', 'Conversation', {});
    expect(result).toBeNull();
  });

  it('handles manage action (maps to all CRUD)', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1', role: 'Member' } } as any);
    const result = await authorize('manage', 'Chat', {});
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 4: Run authorize tests**

```bash
cd libs/shared && bunx vitest run src/rbac/authorize.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Create auth-session.test.ts**

Create `libs/shared/src/auth/auth-session.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: any, init: any) => ({ body, status: init?.status }),
  },
}));

import { getServerSession } from 'next-auth';
import { getSessionTenantId, getSessionUserId, assertSuperAdmin } from './auth-session';

const mockGetServerSession = vi.mocked(getServerSession);

describe('getSessionTenantId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns tenantId when session is valid', async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: 'tenant-1' } } as any);
    const result = await getSessionTenantId({});
    expect(result).toBe('tenant-1');
  });

  it('throws when no session exists', async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(getSessionTenantId({})).rejects.toThrow('Unauthenticated');
  });

  it('throws when session has no tenantId', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1' } } as any);
    await expect(getSessionTenantId({})).rejects.toThrow('Unauthorized');
  });
});

describe('getSessionUserId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns userId when session is valid', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } } as any);
    const result = await getSessionUserId({});
    expect(result).toBe('user-1');
  });

  it('throws when no session exists', async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(getSessionUserId({})).rejects.toThrow('Unauthenticated');
  });
});

describe('assertSuperAdmin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when user is super admin', async () => {
    mockGetServerSession.mockResolvedValue({ user: { isSuperAdmin: true } } as any);
    const result = await assertSuperAdmin({});
    expect(result).toBeNull();
  });

  it('returns 401 when no session', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const result = await assertSuperAdmin({});
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it('returns 403 when user is not super admin', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1', isSuperAdmin: false } } as any);
    const result = await assertSuperAdmin({});
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});
```

- [ ] **Step 6: Run auth-session tests**

```bash
cd libs/shared && bunx vitest run src/auth/auth-session.test.ts
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add libs/shared/src/rbac/permissions.test.ts libs/shared/src/rbac/authorize.test.ts libs/shared/src/auth/auth-session.test.ts && git commit -m "test: add unit tests for RBAC permissions, authorize, and auth session"
```

---

## Task 9: Unit Tests — Repositories (libs/shared)

**Files:**
- Create: `libs/shared/src/db/repositories/conversation/postgres.test.ts`
- Create: `libs/shared/src/db/repositories/message/postgres.test.ts`
- Create: `libs/shared/src/db/repositories/audit-log/postgres.test.ts`

- [ ] **Step 1: Create conversation repository tests**

Create `libs/shared/src/db/repositories/conversation/postgres.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostgresConversationRepository } from './postgres';

function createMockDb() {
  return {
    conversation: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

describe('PostgresConversationRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: PostgresConversationRepository;

  beforeEach(() => {
    db = createMockDb();
    repo = new PostgresConversationRepository(db);
  });

  describe('findById', () => {
    it('returns conversation when found', async () => {
      const conv = { id: '1', title: 'Test' };
      db.conversation.findUnique.mockResolvedValue(conv);
      const result = await repo.findById('1');
      expect(result).toEqual(conv);
      expect(db.conversation.findUnique).toHaveBeenCalledWith({ where: { id: '1' } });
    });

    it('returns null when not found', async () => {
      db.conversation.findUnique.mockResolvedValue(null);
      const result = await repo.findById('missing');
      expect(result).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('returns paginated results with defaults', async () => {
      db.conversation.findMany.mockResolvedValue([{ id: '1' }]);
      db.conversation.count.mockResolvedValue(1);
      const result = await repo.findByUserId('user-1');
      expect(result).toEqual({ items: [{ id: '1' }], total: 1, limit: 20, offset: 0 });
      expect(db.conversation.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        skip: 0,
      });
    });

    it('respects custom pagination params', async () => {
      db.conversation.findMany.mockResolvedValue([]);
      db.conversation.count.mockResolvedValue(0);
      await repo.findByUserId('user-1', { limit: 5, offset: 10 });
      expect(db.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5, skip: 10 }),
      );
    });
  });

  describe('create', () => {
    it('creates a conversation', async () => {
      const input = { userId: 'user-1', title: 'New Chat' };
      const created = { id: '1', ...input };
      db.conversation.create.mockResolvedValue(created);
      const result = await repo.create(input);
      expect(result).toEqual(created);
      expect(db.conversation.create).toHaveBeenCalledWith({ data: input });
    });
  });

  describe('update', () => {
    it('updates a conversation', async () => {
      const updated = { id: '1', title: 'Updated' };
      db.conversation.update.mockResolvedValue(updated);
      const result = await repo.update('1', { title: 'Updated' });
      expect(result).toEqual(updated);
      expect(db.conversation.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { title: 'Updated' },
      });
    });
  });

  describe('delete', () => {
    it('deletes a conversation', async () => {
      db.conversation.delete.mockResolvedValue({});
      await repo.delete('1');
      expect(db.conversation.delete).toHaveBeenCalledWith({ where: { id: '1' } });
    });
  });
});
```

- [ ] **Step 2: Run conversation repo tests**

```bash
cd libs/shared && bunx vitest run src/db/repositories/conversation/postgres.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Create message repository tests**

Create `libs/shared/src/db/repositories/message/postgres.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostgresMessageRepository } from './postgres';

function createMockDb() {
  return {
    message: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    $executeRawUnsafe: vi.fn(),
  };
}

describe('PostgresMessageRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: PostgresMessageRepository;

  beforeEach(() => {
    db = createMockDb();
    repo = new PostgresMessageRepository(db);
  });

  describe('findByConversationId', () => {
    it('returns messages ordered by createdAt asc', async () => {
      const messages = [{ id: '1', role: 'user', content: 'hi' }];
      db.message.findMany.mockResolvedValue(messages);
      const result = await repo.findByConversationId('conv-1');
      expect(result).toEqual(messages);
      expect(db.message.findMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1' },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: { id: true, conversationId: true, role: true, content: true, tokenCount: true, createdAt: true },
      });
    });

    it('respects custom limit', async () => {
      db.message.findMany.mockResolvedValue([]);
      await repo.findByConversationId('conv-1', 10);
      expect(db.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });
  });

  describe('create', () => {
    it('creates a message', async () => {
      const input = { conversationId: 'conv-1', role: 'user', content: 'hello' };
      const created = { id: '1', ...input };
      db.message.create.mockResolvedValue(created);
      const result = await repo.create(input);
      expect(result).toEqual(created);
      expect(db.message.create).toHaveBeenCalledWith({ data: input });
    });
  });

  describe('updateEmbedding', () => {
    it('executes raw SQL to update vector', async () => {
      db.$executeRawUnsafe.mockResolvedValue(1);
      await repo.updateEmbedding('msg-1', [0.1, 0.2, 0.3]);
      expect(db.$executeRawUnsafe).toHaveBeenCalledWith(
        'UPDATE messages SET embedding = $1::vector WHERE id = $2',
        '[0.1,0.2,0.3]',
        'msg-1',
      );
    });
  });
});
```

- [ ] **Step 4: Run message repo tests**

```bash
cd libs/shared && bunx vitest run src/db/repositories/message/postgres.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Create audit-log repository tests**

Create `libs/shared/src/db/repositories/audit-log/postgres.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostgresAuditLogRepository } from './postgres';

function createMockDb() {
  return {
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
  };
}

describe('PostgresAuditLogRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: PostgresAuditLogRepository;

  beforeEach(() => {
    db = createMockDb();
    repo = new PostgresAuditLogRepository(db);
  });

  describe('findAll', () => {
    it('returns paginated results with defaults', async () => {
      db.auditLog.findMany.mockResolvedValue([{ id: '1' }]);
      db.auditLog.count.mockResolvedValue(1);
      const result = await repo.findAll();
      expect(result).toEqual({ items: [{ id: '1' }], total: 1, limit: 50, offset: 0 });
    });

    it('filters by eventType', async () => {
      db.auditLog.findMany.mockResolvedValue([]);
      db.auditLog.count.mockResolvedValue(0);
      await repo.findAll({ eventType: 'login' });
      expect(db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ eventType: 'login' }) }),
      );
    });

    it('filters by severity', async () => {
      db.auditLog.findMany.mockResolvedValue([]);
      db.auditLog.count.mockResolvedValue(0);
      await repo.findAll({ severity: 'high' });
      expect(db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ severity: 'high' }) }),
      );
    });

    it('filters by date range', async () => {
      const start = new Date('2026-01-01');
      const end = new Date('2026-12-31');
      db.auditLog.findMany.mockResolvedValue([]);
      db.auditLog.count.mockResolvedValue(0);
      await repo.findAll({ startDate: start, endDate: end });
      expect(db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: start, lte: end },
          }),
        }),
      );
    });

    it('respects custom pagination', async () => {
      db.auditLog.findMany.mockResolvedValue([]);
      db.auditLog.count.mockResolvedValue(0);
      const result = await repo.findAll({}, { limit: 10, offset: 5 });
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(5);
      expect(db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 5 }),
      );
    });
  });

  describe('create', () => {
    it('creates an audit log entry', async () => {
      const input = { eventType: 'login', action: 'read', severity: 'info' };
      const created = { id: '1', ...input };
      db.auditLog.create.mockResolvedValue(created);
      const result = await repo.create(input);
      expect(result).toEqual(created);
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: input });
    });
  });
});
```

- [ ] **Step 6: Run audit-log repo tests**

```bash
cd libs/shared && bunx vitest run src/db/repositories/audit-log/postgres.test.ts
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add libs/shared/src/db/repositories/*/postgres.test.ts && git commit -m "test: add unit tests for conversation, message, and audit-log repositories"
```

---

## Task 10: Unit Tests — Services & Tenant Middleware (libs/shared)

**Files:**
- Create: `libs/shared/src/db/tenant-middleware.test.ts`
- Create: `libs/shared/src/services/audit-service.test.ts`
- Create: `libs/shared/src/services/conversation-service.test.ts`
- Create: `libs/shared/src/services/message-service.test.ts`
- Create: `libs/shared/src/services/tenant-config-service.test.ts`

- [ ] **Step 1: Create tenant-middleware.test.ts**

Create `libs/shared/src/db/tenant-middleware.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TENANT_SCOPED_MODELS } from './tenant-middleware';

describe('TENANT_SCOPED_MODELS', () => {
  it('contains expected models', () => {
    expect(TENANT_SCOPED_MODELS.has('Conversation')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('AuditLog')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('CustomRole')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('UserTenantRole')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('TenantConfig')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('Invitation')).toBe(true);
  });

  it('does not contain non-scoped models', () => {
    expect(TENANT_SCOPED_MODELS.has('User')).toBe(false);
    expect(TENANT_SCOPED_MODELS.has('Tenant')).toBe(false);
  });

  it('has exactly 6 models', () => {
    expect(TENANT_SCOPED_MODELS.size).toBe(6);
  });
});

describe('getTenantClient', () => {
  it('throws when tenantId is empty', async () => {
    const { getTenantClient } = await import('./tenant-middleware');
    expect(() => getTenantClient('')).toThrow('tenantId is required');
  });
});
```

- [ ] **Step 2: Run tenant-middleware tests**

```bash
cd libs/shared && bunx vitest run src/db/tenant-middleware.test.ts
```

Expected: TENANT_SCOPED_MODELS tests pass. The `getTenantClient('')` test passes (throws on empty string). Note: the import test for `getTenantClient` with a real tenantId would require a database connection, so we only test the validation guard.

- [ ] **Step 3: Create audit-service.test.ts**

Create `libs/shared/src/services/audit-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
vi.mock('../db/tenant-middleware', () => ({
  getTenantClient: vi.fn(() => ({})),
}));
vi.mock('../db/repositories/repository-factory', () => ({
  createAuditLogRepository: vi.fn(() => ({ create: mockCreate })),
}));

import { AuditService } from './audit-service';

describe('AuditService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls repository create with input', async () => {
    mockCreate.mockResolvedValue({ id: '1' });
    await AuditService.log('tenant-1', { eventType: 'login', action: 'read' });
    expect(mockCreate).toHaveBeenCalledWith({ eventType: 'login', action: 'read' });
  });

  it('does not throw when repository create fails', async () => {
    mockCreate.mockRejectedValue(new Error('db error'));
    await expect(
      AuditService.log('tenant-1', { eventType: 'login', action: 'read' }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4: Run audit-service tests**

```bash
cd libs/shared && bunx vitest run src/services/audit-service.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Create conversation-service.test.ts**

Create `libs/shared/src/services/conversation-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRepo = {
  findById: vi.fn(),
  findByUserId: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../db/tenant-middleware', () => ({
  getTenantClient: vi.fn(() => ({})),
}));
vi.mock('../db/repositories/repository-factory', () => ({
  createConversationRepository: vi.fn(() => mockRepo),
}));

import { ConversationService } from './conversation-service';

describe('ConversationService', () => {
  let service: ConversationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ConversationService('tenant-1');
  });

  it('findById delegates to repository', async () => {
    mockRepo.findById.mockResolvedValue({ id: '1', title: 'Test' });
    const result = await service.findById('1');
    expect(result).toEqual({ id: '1', title: 'Test' });
    expect(mockRepo.findById).toHaveBeenCalledWith('1');
  });

  it('findByUserId delegates to repository', async () => {
    mockRepo.findByUserId.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
    const result = await service.findByUserId('user-1', { limit: 10 });
    expect(mockRepo.findByUserId).toHaveBeenCalledWith('user-1', { limit: 10 });
    expect(result.total).toBe(0);
  });

  it('create delegates to repository', async () => {
    const input = { userId: 'user-1', title: 'New' };
    mockRepo.create.mockResolvedValue({ id: '1', ...input });
    const result = await service.create(input);
    expect(result.id).toBe('1');
    expect(mockRepo.create).toHaveBeenCalledWith(input);
  });

  it('update delegates to repository', async () => {
    mockRepo.update.mockResolvedValue({ id: '1', title: 'Updated' });
    const result = await service.update('1', { title: 'Updated' });
    expect(result.title).toBe('Updated');
    expect(mockRepo.update).toHaveBeenCalledWith('1', { title: 'Updated' });
  });

  it('delete delegates to repository', async () => {
    mockRepo.delete.mockResolvedValue(undefined);
    await service.delete('1');
    expect(mockRepo.delete).toHaveBeenCalledWith('1');
  });
});
```

- [ ] **Step 6: Run conversation-service tests**

```bash
cd libs/shared && bunx vitest run src/services/conversation-service.test.ts
```

Expected: All tests pass.

- [ ] **Step 7: Create message-service.test.ts**

Create `libs/shared/src/services/message-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRepo = {
  findByConversationId: vi.fn(),
  create: vi.fn(),
  updateEmbedding: vi.fn(),
};

vi.mock('../db/tenant-middleware', () => ({
  getTenantClient: vi.fn(() => ({})),
}));
vi.mock('../db/repositories/repository-factory', () => ({
  createMessageRepository: vi.fn(() => mockRepo),
}));

import { MessageService } from './message-service';

describe('MessageService', () => {
  let service: MessageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MessageService('tenant-1');
  });

  it('findByConversationId delegates to repository', async () => {
    mockRepo.findByConversationId.mockResolvedValue([{ id: '1', content: 'hi' }]);
    const result = await service.findByConversationId('conv-1', 10);
    expect(result).toHaveLength(1);
    expect(mockRepo.findByConversationId).toHaveBeenCalledWith('conv-1', 10);
  });

  it('create delegates to repository', async () => {
    const input = { conversationId: 'conv-1', role: 'user', content: 'hello' };
    mockRepo.create.mockResolvedValue({ id: '1', ...input });
    const result = await service.create(input);
    expect(result.id).toBe('1');
    expect(mockRepo.create).toHaveBeenCalledWith(input);
  });

  it('updateEmbedding delegates to repository', async () => {
    mockRepo.updateEmbedding.mockResolvedValue(undefined);
    await service.updateEmbedding('msg-1', [0.1, 0.2]);
    expect(mockRepo.updateEmbedding).toHaveBeenCalledWith('msg-1', [0.1, 0.2]);
  });
});
```

- [ ] **Step 8: Run message-service tests**

```bash
cd libs/shared && bunx vitest run src/services/message-service.test.ts
```

Expected: All tests pass.

- [ ] **Step 9: Create tenant-config-service.test.ts**

Create `libs/shared/src/services/tenant-config-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  tenantConfig: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
};

vi.mock('../db/tenant-middleware', () => ({
  getTenantClient: vi.fn(() => mockDb),
}));

import { TenantConfigService } from './tenant-config-service';

describe('TenantConfigService', () => {
  let service: TenantConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TenantConfigService('tenant-1');
  });

  describe('get', () => {
    it('returns config data when found', async () => {
      mockDb.tenantConfig.findFirst.mockResolvedValue({ data: { theme: 'dark' } });
      const result = await service.get('theme');
      expect(result).toEqual({ theme: 'dark' });
      expect(mockDb.tenantConfig.findFirst).toHaveBeenCalledWith({
        where: { configKey: 'theme' },
      });
    });

    it('returns null when not found', async () => {
      mockDb.tenantConfig.findFirst.mockResolvedValue(null);
      const result = await service.get('missing');
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('upserts config with default updatedBy', async () => {
      mockDb.tenantConfig.upsert.mockResolvedValue({});
      await service.set('theme', { mode: 'dark' });
      expect(mockDb.tenantConfig.upsert).toHaveBeenCalledWith({
        where: { tenantId_configKey: { tenantId: '', configKey: 'theme' } },
        create: { configKey: 'theme', data: { mode: 'dark' }, updatedBy: 'system' },
        update: { data: { mode: 'dark' }, updatedBy: 'system' },
      });
    });

    it('upserts config with custom updatedBy', async () => {
      mockDb.tenantConfig.upsert.mockResolvedValue({});
      await service.set('theme', { mode: 'light' }, 'user-1');
      expect(mockDb.tenantConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ updatedBy: 'user-1' }),
          update: expect.objectContaining({ updatedBy: 'user-1' }),
        }),
      );
    });
  });
});
```

- [ ] **Step 10: Run tenant-config-service tests**

```bash
cd libs/shared && bunx vitest run src/services/tenant-config-service.test.ts
```

Expected: All tests pass.

- [ ] **Step 11: Run all libs/shared tests together**

```bash
cd libs/shared && bunx vitest run
```

Expected: All 11 test files pass.

- [ ] **Step 12: Commit**

```bash
git add libs/shared/src/db/tenant-middleware.test.ts libs/shared/src/services/*.test.ts && git commit -m "test: add unit tests for tenant middleware and service layer"
```

---

## Task 11: Unit Tests — AI Library (libs/ai)

**Files:**
- Create: `libs/ai/src/bedrock-client.test.ts`
- Create: `libs/ai/src/chat-completion.test.ts`
- Create: `libs/ai/src/embeddings.test.ts`

- [ ] **Step 1: Create bedrock-client.test.ts**

Create `libs/ai/src/bedrock-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: vi.fn(() => {
    const provider = (model: string) => ({ modelId: model });
    provider.textEmbeddingModel = (model: string) => ({ modelId: model, type: 'embedding' });
    return provider;
  }),
}));

describe('bedrock-client', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('DEFAULT_MODEL is set to Claude Sonnet', async () => {
    const { DEFAULT_MODEL } = await import('./bedrock-client');
    expect(DEFAULT_MODEL).toBe('anthropic.claude-sonnet-4-20250514');
  });

  it('getBedrockProvider returns a provider', async () => {
    const { getBedrockProvider } = await import('./bedrock-client');
    const provider = getBedrockProvider();
    expect(provider).toBeDefined();
    expect(typeof provider).toBe('function');
  });

  it('getBedrockProvider returns the same instance on repeated calls', async () => {
    const { getBedrockProvider } = await import('./bedrock-client');
    const a = getBedrockProvider();
    const b = getBedrockProvider();
    expect(a).toBe(b);
  });

  it('provider can create a model reference', async () => {
    const { getBedrockProvider } = await import('./bedrock-client');
    const provider = getBedrockProvider();
    const model = provider('anthropic.claude-sonnet-4-20250514');
    expect(model).toEqual({ modelId: 'anthropic.claude-sonnet-4-20250514' });
  });
});
```

- [ ] **Step 2: Run bedrock-client tests**

```bash
cd libs/ai && bunx vitest run src/bedrock-client.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Create chat-completion.test.ts**

Create `libs/ai/src/chat-completion.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStreamText = vi.fn(() => ({ textStream: 'mock-stream' }));

vi.mock('ai', () => ({
  streamText: mockStreamText,
}));

vi.mock('./bedrock-client', () => {
  const provider = (model: string) => ({ modelId: model });
  provider.textEmbeddingModel = (model: string) => ({ modelId: model });
  return {
    getBedrockProvider: vi.fn(() => provider),
    DEFAULT_MODEL: 'anthropic.claude-sonnet-4-20250514',
  };
});

import { streamChat, type StreamChatOptions } from './chat-completion';

describe('streamChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls streamText with default options', () => {
    const options: StreamChatOptions = {
      messages: [{ role: 'user', content: 'hello' }] as any,
    };
    streamChat(options);
    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: options.messages,
        temperature: 0.7,
        maxOutputTokens: 4096,
      }),
    );
  });

  it('uses DEFAULT_MODEL when no model specified', () => {
    streamChat({ messages: [] as any });
    const call = mockStreamText.mock.calls[0][0];
    expect(call.model).toEqual({ modelId: 'anthropic.claude-sonnet-4-20250514' });
  });

  it('uses custom model when specified', () => {
    streamChat({ messages: [] as any, model: 'anthropic.claude-haiku-4-5-20251001' });
    const call = mockStreamText.mock.calls[0][0];
    expect(call.model).toEqual({ modelId: 'anthropic.claude-haiku-4-5-20251001' });
  });

  it('passes system prompt', () => {
    streamChat({ messages: [] as any, system: 'You are helpful.' });
    const call = mockStreamText.mock.calls[0][0];
    expect(call.system).toBe('You are helpful.');
  });

  it('passes custom temperature and maxOutputTokens', () => {
    streamChat({ messages: [] as any, temperature: 0.2, maxOutputTokens: 1024 });
    const call = mockStreamText.mock.calls[0][0];
    expect(call.temperature).toBe(0.2);
    expect(call.maxOutputTokens).toBe(1024);
  });

  it('passes onFinish callback', () => {
    const onFinish = vi.fn();
    streamChat({ messages: [] as any, onFinish });
    const call = mockStreamText.mock.calls[0][0];
    expect(call.onFinish).toBe(onFinish);
  });
});
```

- [ ] **Step 4: Run chat-completion tests**

```bash
cd libs/ai && bunx vitest run src/chat-completion.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Create embeddings.test.ts**

Create `libs/ai/src/embeddings.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEmbed = vi.fn();
const mockEmbedMany = vi.fn();

vi.mock('ai', () => ({
  embed: mockEmbed,
  embedMany: mockEmbedMany,
}));

vi.mock('./bedrock-client', () => {
  const provider = (model: string) => ({ modelId: model });
  provider.textEmbeddingModel = (model: string) => ({ modelId: model, type: 'embedding' });
  return {
    getBedrockProvider: vi.fn(() => provider),
    DEFAULT_MODEL: 'anthropic.claude-sonnet-4-20250514',
  };
});

import { generateEmbedding, generateEmbeddings } from './embeddings';

describe('generateEmbedding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns embedding vector for a single text', async () => {
    mockEmbed.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
    const result = await generateEmbedding('hello world');
    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(mockEmbed).toHaveBeenCalledWith({
      model: { modelId: 'amazon.titan-embed-text-v2:0', type: 'embedding' },
      value: 'hello world',
    });
  });
});

describe('generateEmbeddings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns embedding vectors for multiple texts', async () => {
    mockEmbedMany.mockResolvedValue({
      embeddings: [[0.1, 0.2], [0.3, 0.4]],
    });
    const result = await generateEmbeddings(['hello', 'world']);
    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(mockEmbedMany).toHaveBeenCalledWith({
      model: { modelId: 'amazon.titan-embed-text-v2:0', type: 'embedding' },
      values: ['hello', 'world'],
    });
  });

  it('handles empty array', async () => {
    mockEmbedMany.mockResolvedValue({ embeddings: [] });
    const result = await generateEmbeddings([]);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 6: Run embeddings tests**

```bash
cd libs/ai && bunx vitest run src/embeddings.test.ts
```

Expected: All tests pass.

- [ ] **Step 7: Run all libs/ai tests together**

```bash
cd libs/ai && bunx vitest run
```

Expected: All 3 test files pass.

- [ ] **Step 8: Commit**

```bash
git add libs/ai/src/*.test.ts && git commit -m "test: add unit tests for bedrock client, chat completion, and embeddings"
```

---

## Task 12: Coverage Thresholds & Final Verification

**Files:**
- Modify: `libs/shared/vitest.config.ts`
- Modify: `libs/ai/vitest.config.ts`

- [ ] **Step 1: Add coverage thresholds to libs/shared/vitest.config.ts**

Replace `libs/shared/vitest.config.ts` with:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 60,
        branches: 60,
        functions: 60,
      },
    },
  },
});
```

- [ ] **Step 2: Add coverage thresholds to libs/ai/vitest.config.ts**

Replace `libs/ai/vitest.config.ts` with:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 60,
        branches: 60,
        functions: 60,
      },
    },
  },
});
```

- [ ] **Step 3: Run all unit tests with coverage**

```bash
cd libs/shared && bunx vitest run --coverage && cd ../../libs/ai && bunx vitest run --coverage
```

Expected: All tests pass, coverage meets 60% thresholds.

- [ ] **Step 4: Verify full build**

```bash
cd apps/web-ui && bun run build
```

Expected: Build succeeds with fumadocs, marketing page, and docs pages.

- [ ] **Step 5: Commit**

```bash
git add libs/shared/vitest.config.ts libs/ai/vitest.config.ts && git commit -m "chore: add coverage thresholds (60% lines/branches/functions)"
```

- [ ] **Step 6: Final verification — run everything**

```bash
cd libs/shared && bunx vitest run && cd ../../libs/ai && bunx vitest run && cd ../.. && bunx playwright test
```

Expected: All unit tests pass, all e2e tests pass.
