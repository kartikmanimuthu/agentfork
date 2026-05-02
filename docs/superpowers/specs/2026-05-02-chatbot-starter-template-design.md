# Chatbot Starter Template — Design Spec

**Date:** 2026-05-02
**Status:** Draft
**Baseline:** nucleus-cloud-ops (master-v1)

## Overview

A domain-agnostic, production-ready chatbot starter template that mirrors the architecture and patterns of nucleus-cloud-ops. Built as an Nx monorepo with Next.js 15 frontend, pg-boss workers, Pulumi infrastructure, and AWS Bedrock AI integration. Supports multi-tenancy, RBAC, streaming chat, and horizontal scaling via ECS Fargate.

## Architecture

**Monorepo with Nx:**
- `apps/` — deployable services (web-ui, workers; future Python services)
- `libs/` — shared code (`@chatbot/shared`, `@chatbot/ai`)
- `infra/` — Pulumi IaC (networking + compute stacks)
- `prisma/` — unified Prisma schema and migrations

**Tech Stack:**
- Runtime: Node.js 20+, Bun 1.x (package manager + production runtime)
- Language: TypeScript 5.6+ (strict mode)
- Frontend: Next.js 15 (App Router), React 19, Tailwind CSS, Radix UI
- Database: PostgreSQL 16 + pgvector (Prisma ORM 5.22)
- Auth: NextAuth.js + AWS Cognito
- AI: AWS Bedrock (Claude models) via Vercel AI SDK
- Job Queue: pg-boss 10.x
- Infra: Pulumi (VPC, ECS Fargate, RDS, CloudFront, Cognito, S3)
- Testing: Vitest (unit), Playwright (E2E)
- Monorepo: Nx (task pipeline, caching, affected commands)

## Project Structure

```
chatbot/
├── nx.json                         # Nx workspace config
├── package.json                    # Root deps + Nx CLI
├── tsconfig.base.json              # Shared TS config (path aliases)
├── docker-compose.yml              # Local PostgreSQL + pgvector
├── .env.example                    # Root env template
├── prisma/
│   ├── schema.prisma               # Unified Prisma schema
│   └── migrations/
│
├── apps/
│   ├── web-ui/                     # Next.js 15 (port 3001)
│   │   ├── project.json            # Nx targets: build, serve, test, docker-build
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   ├── middleware.ts            # Auth, tenant resolution, header injection
│   │   ├── .env.local.example
│   │   ├── Dockerfile              # Multi-stage: deps → builder → runner (Bun)
│   │   ├── docker-entrypoint.sh    # DB retry + prisma migrate deploy + start
│   │   ├── app/
│   │   │   ├── layout.tsx          # Root layout (providers, theme, toaster)
│   │   │   ├── page.tsx            # Home / redirect
│   │   │   ├── api/
│   │   │   │   ├── auth/[...nextauth]/route.ts
│   │   │   │   ├── chat/route.ts               # POST streaming chat
│   │   │   │   ├── conversations/route.ts       # GET/POST conversations
│   │   │   │   ├── conversations/[id]/route.ts  # GET/PUT/DELETE single
│   │   │   │   ├── messages/route.ts            # GET message history
│   │   │   │   ├── tenants/route.ts             # POST create org
│   │   │   │   ├── invitations/route.ts         # POST invite user
│   │   │   │   ├── audit/route.ts               # GET audit logs
│   │   │   │   └── health/route.ts              # GET health check
│   │   │   ├── (auth)/
│   │   │   │   ├── login/page.tsx
│   │   │   │   └── register/page.tsx
│   │   │   └── (dashboard)/
│   │   │       ├── layout.tsx                   # Sidebar + auth guard
│   │   │       ├── chat/page.tsx                # Main chat interface
│   │   │       ├── conversations/page.tsx       # Conversation history
│   │   │       └── settings/page.tsx            # Tenant/user settings
│   │   ├── components/
│   │   │   ├── chat/
│   │   │   │   ├── chat-input.tsx               # Message input with submit
│   │   │   │   ├── chat-messages.tsx            # Message list with streaming
│   │   │   │   └── chat-bubble.tsx              # Single message bubble
│   │   │   ├── layout/
│   │   │   │   ├── sidebar.tsx
│   │   │   │   ├── layout-wrapper.tsx
│   │   │   │   └── auth-guard.tsx
│   │   │   └── ui/                              # Radix UI primitives
│   │   │       ├── button.tsx
│   │   │       ├── dialog.tsx
│   │   │       ├── dropdown-menu.tsx
│   │   │       ├── input.tsx
│   │   │       ├── scroll-area.tsx
│   │   │       ├── avatar.tsx
│   │   │       └── toast.tsx
│   │   └── lib/                                 # App-specific helpers
│   │       └── hooks/
│   │           └── use-chat-scroll.ts           # Auto-scroll on new messages
│   │
│   └── workers/                    # pg-boss job processor
│       ├── project.json            # Nx targets: build, serve, test, docker-build
│       ├── tsconfig.json
│       ├── .env.example
│       ├── Dockerfile              # Multi-stage: builder → runner (Bun)
│       ├── src/
│       │   ├── index.ts            # Entry: pg-boss init, job registration
│       │   ├── boss.ts             # pg-boss config (retries, expiry, archive)
│       │   ├── executor/
│       │   │   ├── types.ts        # JobExecutor interface
│       │   │   ├── vertical.ts     # In-process (dev)
│       │   │   ├── horizontal.ts   # ECS Fargate dispatch (prod)
│       │   │   └── factory.ts      # Selection via WORKER_ARCH env
│       │   ├── jobs/
│       │   │   ├── message-embedding/
│       │   │   │   ├── handler.ts  # Generate Titan embedding, store in Message
│       │   │   │   └── register.ts # Job registration with pg-boss
│       │   │   └── conversation-summary/
│       │   │       ├── handler.ts  # Summarize long conversations
│       │   │       └── register.ts
│       │   └── lib/
│       │       └── logger.ts       # Structured logging
│       └── vitest.config.ts
│
├── libs/
│   ├── shared/                     # @chatbot/shared
│   │   ├── project.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts            # Public API barrel
│   │   │   ├── db/
│   │   │   │   ├── prisma-client.ts        # Singleton (global in dev)
│   │   │   │   ├── tenant-middleware.ts     # getTenantClient() query interception
│   │   │   │   └── repositories/
│   │   │   │       ├── conversation/
│   │   │   │       │   ├── interface.ts     # ConversationRepository interface
│   │   │   │       │   └── postgres.ts      # Prisma implementation
│   │   │   │       ├── message/
│   │   │   │       │   ├── interface.ts
│   │   │   │       │   └── postgres.ts
│   │   │   │       ├── audit-log/
│   │   │   │       │   ├── interface.ts
│   │   │   │       │   └── postgres.ts
│   │   │   │       └── repository-factory.ts
│   │   │   ├── auth/
│   │   │   │   ├── auth-session.ts          # getSessionTenantId, getSessionUserId
│   │   │   │   ├── auth-options.ts          # NextAuth + Cognito config
│   │   │   │   └── types.ts                 # Session, user types
│   │   │   ├── rbac/
│   │   │   │   ├── authorize.ts             # authorize(action, module) helper
│   │   │   │   ├── permissions.ts           # Permission matrix
│   │   │   │   └── types.ts                 # Modules, actions, roles
│   │   │   ├── services/
│   │   │   │   ├── conversation-service.ts  # Conversation CRUD
│   │   │   │   ├── message-service.ts       # Message persistence + retrieval
│   │   │   │   ├── audit-service.ts         # Fire-and-forget audit logging
│   │   │   │   └── tenant-config-service.ts # Tenant key-value config
│   │   │   └── types/
│   │   │       └── domain.ts                # Shared domain types
│   │   └── vitest.config.ts
│   │
│   └── ai/                         # @chatbot/ai
│       ├── project.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts            # Public API barrel
│       │   ├── bedrock-client.ts   # @ai-sdk/amazon-bedrock provider instance
│       │   ├── chat-completion.ts  # streamChat(messages, options)
│       │   └── embeddings.ts       # Titan embedding generation (1024-dim)
│       └── vitest.config.ts
│
└── infra/
    ├── project.json                # Nx targets: deploy-networking, deploy-compute
    ├── package.json                # Pulumi + AWS SDK deps
    ├── tsconfig.json
    ├── Pulumi.yaml
    ├── networking/
    │   └── index.ts                # VPC, 4-tier subnets, NAT, S3 endpoint
    └── compute/
        └── index.ts                # RDS, Cognito, S3, ECR, ECS, ALB, CloudFront, IAM
```

## Data Model

### Prisma Schema

**Auth & Tenancy:**

| Model | Fields | Purpose |
|-------|--------|---------|
| `Tenant` | id, name, slug, status, createdAt, updatedAt | Organization |
| `TenantConfig` | id, tenantId, key, value | Per-tenant key-value config |
| `AuthUser` | id, email, name, passwordHash, isSuperAdmin, activeTenantId | User account |
| `AuthAccount` | id, userId, provider, providerAccountId | OAuth link |
| `AuthSession` | id, sessionToken, userId, expires | DB-backed session |
| `VerificationToken` | identifier, token, expires | Email verification |
| `UserTenantRole` | id, userId, tenantId, role, roleId | Membership + role |
| `CustomRole` | id, tenantId, name, permissions, level | Custom RBAC role |
| `Invitation` | id, tenantId, email, role, status, expiresAt | User invitation |

**Chat Domain:**

| Model | Fields | Purpose |
|-------|--------|---------|
| `Conversation` | id, tenantId, userId, title, model, status, messageCount, createdAt, updatedAt | Chat thread |
| `Message` | id, conversationId, role (user/assistant/system), content, tokenCount, embedding (vector 1024), createdAt | Individual message |
| `ConversationSummary` | id, conversationId, summary, messageRange, createdAt | Worker-generated summary |

**Audit:**

| Model | Fields | Purpose |
|-------|--------|---------|
| `AuditLog` | id, tenantId, eventType, action, userId, resource, status, severity, metadata, ttl, createdAt | Immutable audit trail |

**Tenant-scoped models:** Conversation, Message (via conversation), ConversationSummary (via conversation), AuditLog, CustomRole, Invitation, UserTenantRole, TenantConfig.

**pgvector:** `Message.embedding` column (1024-dim) for semantic search over conversation history.

## Chat Flow

### Streaming Chat Request

1. `POST /api/chat` receives `{ conversationId, content, model? }`
2. Validate session via `getSessionTenantId()` + `getSessionUserId()`
3. Check RBAC: `authorize('create', 'Chat')`
4. Persist user `Message` (role: 'user')
5. Load conversation history (last N messages + latest summary if available)
6. Call Bedrock via AI SDK `streamText()`:
   - Provider: `@ai-sdk/amazon-bedrock`
   - Model: tenant-configured or default (Claude Sonnet)
   - System prompt: configurable per tenant
   - Messages: conversation history
7. Stream response via `toDataStreamResponse()`
8. On completion callback:
   - Persist assistant `Message` (role: 'assistant') with token counts
   - Enqueue `message-embedding` pg-boss job for both messages
   - If `conversation.messageCount > threshold`: enqueue `conversation-summary` job
9. Update `conversation.messageCount` and `conversation.updatedAt`

### Frontend Chat UI

- `useChat()` hook from `ai/react` — handles streaming, loading, error states
- `chat-messages.tsx` renders message list with auto-scroll
- `chat-input.tsx` with submit on Enter, disabled during streaming
- `chat-bubble.tsx` renders markdown content with syntax highlighting
- Conversation sidebar lists recent conversations, supports create/rename/delete

## Authentication & Authorization

### Auth Flow (NextAuth + Cognito)

1. User navigates to app → middleware checks session
2. No session → redirect to `/login`
3. Login via Cognito (OAuth) → NextAuth creates `AuthSession` in DB
4. Middleware injects `x-tenant-id` header from `AuthUser.activeTenantId`
5. API routes extract tenant/user via `getSessionTenantId()` / `getSessionUserId()`

### RBAC

**Modules:** Chat, Conversations, Settings

**Actions:** create, read, update, delete

**Predefined Roles:**

| Role | Level | Chat | Conversations | Settings |
|------|-------|------|---------------|----------|
| Viewer | 1 | read | read | read |
| Member | 2 | create, read | create, read | read |
| Admin | 3 | CRUD | CRUD | create, read, update |
| Owner | 4 | CRUD | CRUD | CRUD |

**Super admin:** bypasses all permission checks (same as baseline).

**Custom roles:** stored in `CustomRole` table with JSON permissions and a level. `authorize()` checks custom role if `UserTenantRole.roleId` is set.

## Multi-Tenancy

- All tenant-scoped models have `tenantId` column with foreign key to `Tenant`
- `getTenantClient()` middleware wraps Prisma client, intercepts `findMany`, `findFirst`, `findUnique`, `create`, `update`, `delete` to inject tenant filter
- `TENANT_SCOPED_MODELS` constant defines which models are scoped
- No cross-tenant data leakage by design — queries without tenant context throw
- Tenant switching: update `AuthUser.activeTenantId`, middleware picks up new tenant on next request

## Worker Jobs

### pg-boss Configuration

- Queue: PostgreSQL-backed (same DB)
- Retries: 3 with 30s delay + exponential backoff
- Expiry: 4 hours
- Archive: 7 days
- Executor: vertical (dev, in-process) or horizontal (prod, ECS Fargate task)

### Job: message-embedding

- **Trigger:** After each message is persisted
- **Input:** `{ messageId: string }`
- **Process:** Load message content → generate Titan embedding (1024-dim) → update `Message.embedding`
- **Purpose:** Enables semantic search over conversation history

### Job: conversation-summary

- **Trigger:** When `conversation.messageCount` exceeds threshold stored in `TenantConfig` key `conversation.summaryThreshold` (default: 50)
- **Input:** `{ conversationId: string, fromMessageIndex: number }`
- **Process:** Load messages in range → call Bedrock to generate summary → store in `ConversationSummary`
- **Purpose:** Compress context for long conversations, reduce token usage

## Infrastructure

### Local Development

`docker-compose.yml`:
- PostgreSQL 16 with pgvector extension (port 5432)
- Health check: `pg_isready`
- Volume: `pgdata` for persistence
- DB: `chatbot`, user: `chatbot_admin`

### Pulumi Networking Stack

- VPC: configurable CIDR (default /16)
- 4-tier subnets: Private (/22), Public (/24), Database (/24), Intra (/26)
- 2 AZs (configurable region, default ap-south-1)
- NAT Gateways (one per AZ)
- S3 Gateway Endpoint
- RDS + subnet groups

### Pulumi Compute Stack

- **RDS:** PostgreSQL 16, db.t4g.micro, 20GB gp3, pgvector, single-AZ
- **Cognito:** User Pool + Identity Pool + App Client
- **S3:** App bucket (conversation-exports/, attachments/ with lifecycle policies)
- **ECR:** 2 repositories (web-ui, workers)
- **ECS:** Cluster + 2 Fargate services (ARM64)
  - web-ui: port 3001, 0.25 vCPU, 512MB
  - workers: no port, 0.25 vCPU, 512MB
- **ALB:** Port 80, health check on `/api/health`, CloudFront origin verify header
- **CloudFront:** HTTPS termination, origin verify secret
- **Auto Scaling:** CPU 70%, Memory 75% targets
- **Secrets Manager:** NEXTAUTH_SECRET, DATABASE_URL
- **IAM:** Task execution role (ECR pull, secrets read), task role (S3, Bedrock invoke for workers)
- **CloudWatch:** Log groups with 7-day retention

## Testing

- **Unit tests:** Vitest, co-located `.test.ts` files in all packages
- **E2E tests:** Playwright (chat flow, auth flow, conversation CRUD)
- **Nx integration:** `nx run <project>:test`, `nx affected:test` for CI
- **Coverage targets:** Not enforced in starter (teams configure per preference)

## Nx Configuration

### Task Pipeline (nx.json)

```
build → depends on ^build (libs first)
serve → no dependencies (parallel start)
test → no dependencies (parallel run)
docker-build → depends on build
deploy-networking → standalone
deploy-compute → depends on deploy-networking
```

### Path Aliases (tsconfig.base.json)

```
@chatbot/shared → libs/shared/src
@chatbot/ai → libs/ai/src
```

### Cacheable Targets

build, test, lint — cached by Nx for unchanged inputs.

## Intentional Exclusions

- No knowledge base / RAG pipeline
- No agent framework (LangGraph, MCP, tool-use)
- No file upload or attachment handling
- No billing or usage tracking
- No CI/CD pipeline files (team-specific)
- No Redis/Memcached caching layer
- No MongoDB (baseline uses it for LangGraph checkpoints — not needed here)
