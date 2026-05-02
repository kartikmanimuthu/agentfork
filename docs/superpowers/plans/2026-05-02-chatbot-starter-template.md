# Chatbot Starter Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a production-ready, domain-agnostic chatbot starter template as an Nx monorepo, mirroring nucleus-cloud-ops architecture patterns.

**Architecture:** Nx monorepo with `apps/web-ui` (Next.js 15), `apps/workers` (pg-boss), `libs/shared` (@chatbot/shared), `libs/ai` (@chatbot/ai), `infra/` (Pulumi), and `prisma/` (unified schema). Multi-tenant with RBAC, streaming chat via Bedrock, PostgreSQL + pgvector.

**Tech Stack:** TypeScript 5.6+ (strict), Bun 1.x, Next.js 15, React 19, Tailwind CSS, Radix UI, Prisma 5.22, PostgreSQL 16 + pgvector, NextAuth + Cognito, AI SDK + Bedrock, pg-boss 10.x, Pulumi, Nx, Vitest, Playwright.

---

## File Map

### Root
- Create: `package.json` — root workspace with Nx CLI, shared dev deps
- Create: `nx.json` — task pipeline, caching config
- Create: `tsconfig.base.json` — shared TS config with path aliases
- Create: `docker-compose.yml` — local PostgreSQL 16 + pgvector
- Create: `.env.example` — root env template
- Create: `.gitignore` — Node/Next.js/Prisma/Nx ignores
- Create: `.prettierrc` — code formatting
- Create: `.eslintrc.json` — root lint config

### Prisma
- Create: `prisma/schema.prisma` — unified schema (all models)

### libs/shared
- Create: `libs/shared/project.json` — Nx project config
- Create: `libs/shared/tsconfig.json` — TS config extending base
- Create: `libs/shared/tsconfig.lib.json` — lib-specific TS config
- Create: `libs/shared/vitest.config.ts` — test config
- Create: `libs/shared/src/index.ts` — barrel export
- Create: `libs/shared/src/db/prisma-client.ts` — Prisma singleton
- Create: `libs/shared/src/db/tenant-middleware.ts` — getTenantClient()
- Create: `libs/shared/src/db/repositories/conversation/interface.ts`
- Create: `libs/shared/src/db/repositories/conversation/postgres.ts`
- Create: `libs/shared/src/db/repositories/message/interface.ts`
- Create: `libs/shared/src/db/repositories/message/postgres.ts`
- Create: `libs/shared/src/db/repositories/audit-log/interface.ts`
- Create: `libs/shared/src/db/repositories/audit-log/postgres.ts`
- Create: `libs/shared/src/db/repositories/repository-factory.ts`
- Create: `libs/shared/src/auth/auth-session.ts`
- Create: `libs/shared/src/auth/auth-options.ts`
- Create: `libs/shared/src/auth/types.ts`
- Create: `libs/shared/src/rbac/authorize.ts`
- Create: `libs/shared/src/rbac/permissions.ts`
- Create: `libs/shared/src/rbac/types.ts`
- Create: `libs/shared/src/services/conversation-service.ts`
- Create: `libs/shared/src/services/message-service.ts`
- Create: `libs/shared/src/services/audit-service.ts`
- Create: `libs/shared/src/services/tenant-config-service.ts`
- Create: `libs/shared/src/types/domain.ts`

### libs/ai
- Create: `libs/ai/project.json` — Nx project config
- Create: `libs/ai/tsconfig.json` — TS config extending base
- Create: `libs/ai/tsconfig.lib.json` — lib-specific TS config
- Create: `libs/ai/vitest.config.ts` — test config
- Create: `libs/ai/src/index.ts` — barrel export
- Create: `libs/ai/src/bedrock-client.ts` — Bedrock provider instance
- Create: `libs/ai/src/chat-completion.ts` — streamChat()
- Create: `libs/ai/src/embeddings.ts` — Titan embeddings

### apps/web-ui
- Create: `apps/web-ui/project.json` — Nx project config
- Create: `apps/web-ui/package.json` — Next.js deps
- Create: `apps/web-ui/tsconfig.json` — Next.js TS config
- Create: `apps/web-ui/next.config.ts` — Next.js config
- Create: `apps/web-ui/tailwind.config.ts` — Tailwind config
- Create: `apps/web-ui/postcss.config.js` — PostCSS config
- Create: `apps/web-ui/.env.local.example` — env template
- Create: `apps/web-ui/Dockerfile` — multi-stage build
- Create: `apps/web-ui/docker-entrypoint.sh` — DB retry + migrate + start
- Create: `apps/web-ui/middleware.ts` — auth + tenant middleware
- Create: `apps/web-ui/app/layout.tsx` — root layout
- Create: `apps/web-ui/app/page.tsx` — home redirect
- Create: `apps/web-ui/app/globals.css` — Tailwind imports
- Create: `apps/web-ui/app/api/auth/[...nextauth]/route.ts`
- Create: `apps/web-ui/app/api/chat/route.ts`
- Create: `apps/web-ui/app/api/conversations/route.ts`
- Create: `apps/web-ui/app/api/conversations/[id]/route.ts`
- Create: `apps/web-ui/app/api/messages/route.ts`
- Create: `apps/web-ui/app/api/tenants/route.ts`
- Create: `apps/web-ui/app/api/invitations/route.ts`
- Create: `apps/web-ui/app/api/audit/route.ts`
- Create: `apps/web-ui/app/api/health/route.ts`
- Create: `apps/web-ui/app/(auth)/login/page.tsx`
- Create: `apps/web-ui/app/(auth)/register/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/layout.tsx`
- Create: `apps/web-ui/app/(dashboard)/chat/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/conversations/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/settings/page.tsx`
- Create: `apps/web-ui/components/chat/chat-input.tsx`
- Create: `apps/web-ui/components/chat/chat-messages.tsx`
- Create: `apps/web-ui/components/chat/chat-bubble.tsx`
- Create: `apps/web-ui/components/layout/sidebar.tsx`
- Create: `apps/web-ui/components/layout/layout-wrapper.tsx`
- Create: `apps/web-ui/components/layout/auth-guard.tsx`
- Create: `apps/web-ui/components/ui/button.tsx`
- Create: `apps/web-ui/components/ui/dialog.tsx`
- Create: `apps/web-ui/components/ui/dropdown-menu.tsx`
- Create: `apps/web-ui/components/ui/input.tsx`
- Create: `apps/web-ui/components/ui/scroll-area.tsx`
- Create: `apps/web-ui/components/ui/avatar.tsx`
- Create: `apps/web-ui/components/ui/toast.tsx`
- Create: `apps/web-ui/lib/hooks/use-chat-scroll.ts`
- Create: `apps/web-ui/lib/utils.ts` — cn() helper

### apps/workers
- Create: `apps/workers/project.json` — Nx project config
- Create: `apps/workers/package.json` — worker deps
- Create: `apps/workers/tsconfig.json` — TS config
- Create: `apps/workers/.env.example` — env template
- Create: `apps/workers/Dockerfile` — multi-stage build
- Create: `apps/workers/vitest.config.ts` — test config
- Create: `apps/workers/src/index.ts` — entry point
- Create: `apps/workers/src/boss.ts` — pg-boss config
- Create: `apps/workers/src/executor/types.ts`
- Create: `apps/workers/src/executor/vertical.ts`
- Create: `apps/workers/src/executor/horizontal.ts`
- Create: `apps/workers/src/executor/factory.ts`
- Create: `apps/workers/src/jobs/message-embedding/handler.ts`
- Create: `apps/workers/src/jobs/message-embedding/register.ts`
- Create: `apps/workers/src/jobs/conversation-summary/handler.ts`
- Create: `apps/workers/src/jobs/conversation-summary/register.ts`
- Create: `apps/workers/src/lib/logger.ts`

### infra
- Create: `infra/project.json` — Nx project config
- Create: `infra/package.json` — Pulumi + AWS deps
- Create: `infra/tsconfig.json` — TS config
- Create: `infra/Pulumi.yaml` — Pulumi project config
- Create: `infra/networking/index.ts` — VPC stack
- Create: `infra/compute/index.ts` — compute stack

---

## Task 1: Nx Workspace Scaffolding & Root Config

**Files:**
- Create: `package.json`
- Create: `nx.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.prettierrc`
- Create: `.env.example`
- Create: `docker-compose.yml`

- [ ] **Step 1: Initialize root package.json**

```json
{
  "name": "@chatbot/source",
  "version": "0.0.0",
  "private": true,
  "packageManager": "bun@1.2.12",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "prepare": "prisma generate --schema=./prisma/schema.prisma"
  },
  "devDependencies": {
    "@nx/js": "^21.0.0",
    "@nx/next": "^21.0.0",
    "@nx/vite": "^21.0.0",
    "@nx/eslint-plugin": "^21.0.0",
    "@types/node": "^22.0.0",
    "eslint": "^9.0.0",
    "nx": "^21.0.0",
    "prettier": "^3.4.0",
    "prisma": "^6.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  },
  "dependencies": {
    "@prisma/client": "^6.0.0",
    "tslib": "^2.8.0"
  }
}
```

- [ ] **Step 2: Create nx.json**

```json
{
  "$schema": "./node_modules/nx/schemas/nx-schema.json",
  "namedInputs": {
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "sharedGlobals": ["{workspaceRoot}/tsconfig.base.json"],
    "production": ["default", "!{projectRoot}/**/*.test.ts", "!{projectRoot}/vitest.config.ts"]
  },
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["production", "^production"],
      "cache": true
    },
    "test": {
      "inputs": ["default", "^production"],
      "cache": true
    },
    "lint": {
      "inputs": ["default"],
      "cache": true
    }
  },
  "defaultBase": "main"
}
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compileOnSave": false,
  "compilerOptions": {
    "rootDir": ".",
    "sourceMap": true,
    "declaration": false,
    "moduleResolution": "bundler",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "importHelpers": true,
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "skipLibCheck": true,
    "skipDefaultLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@chatbot/shared": ["libs/shared/src/index.ts"],
      "@chatbot/ai": ["libs/ai/src/index.ts"]
    }
  },
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
.next/
.env
.env.local
*.log
.nx/
.prisma/
```

- [ ] **Step 5: Create .prettierrc**

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true
}
```

- [ ] **Step 6: Create .env.example**

```bash
# Database
DATABASE_URL="postgresql://chatbot_admin:chatbot_dev@localhost:5432/chatbot?schema=public"

# AWS
AWS_REGION=ap-south-1
AWS_ACCOUNT_ID=

# Domain
APP_URL=http://localhost:3001
```

- [ ] **Step 7: Create docker-compose.yml**

```yaml
version: '3.8'
services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: chatbot-postgres
    environment:
      POSTGRES_DB: chatbot
      POSTGRES_USER: chatbot_admin
      POSTGRES_PASSWORD: chatbot_dev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U chatbot_admin -d chatbot"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  postgres_data:
```

- [ ] **Step 8: Install dependencies and verify**

Run: `cd /Users/kartik/Documents/git-repo/chatbot && bun install`
Expected: Dependencies install successfully, `node_modules/` created.

- [ ] **Step 9: Commit**

```bash
git add package.json nx.json tsconfig.base.json .gitignore .prettierrc .env.example docker-compose.yml bun.lock
git commit -m "feat: scaffold Nx workspace with root config

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 2: Prisma Schema & Database Setup

**Files:**
- Create: `prisma/schema.prisma`

- [ ] **Step 1: Create prisma/schema.prisma**

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "linux-arm64-openssl-3.0.x"]
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector]
}

model Tenant {
  id        String   @id @default(cuid())
  name      String
  slug      String?  @unique
  status    String   @default("active")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  configs       TenantConfig[]
  conversations Conversation[]
  auditLogs     AuditLog[]
  customRoles   CustomRole[]
  invitations   Invitation[]
  userRoles     UserTenantRole[]

  @@index([status])
  @@map("tenants")
}

model TenantConfig {
  id        String   @id @default(cuid())
  tenantId  String
  configKey String
  data      Json
  updatedAt DateTime @updatedAt
  updatedBy String   @default("system")

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, configKey])
  @@index([tenantId])
  @@map("tenant_configs")
}

model AuthUser {
  id             String    @id @default(cuid())
  email          String    @unique
  name           String?
  emailVerified  DateTime?
  image          String?
  passwordHash   String?
  isSuperAdmin   Boolean   @default(false)
  activeTenantId String?
  failedAttempts Int       @default(0)
  lockedUntil    DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  accounts AuthAccount[]
  sessions AuthSession[]
  roles    UserTenantRole[]

  @@map("auth_users")
}

model AuthAccount {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?

  user AuthUser @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@map("auth_accounts")
}

model AuthSession {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user AuthUser @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("auth_sessions")
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
  @@map("verification_tokens")
}

model UserTenantRole {
  id         String    @id @default(cuid())
  userId     String
  tenantId   String
  email      String
  role       String
  roleId     String?
  assignedAt DateTime  @default(now())
  assignedBy String

  tenant     Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  customRole CustomRole? @relation(fields: [roleId], references: [id], onDelete: SetNull)

  @@unique([userId, tenantId])
  @@index([tenantId])
  @@index([roleId])
  @@map("user_tenant_roles")
}

model CustomRole {
  id          String   @id @default(cuid())
  tenantId    String
  name        String
  description String?
  permissions Json
  level       Int      @default(1)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tenant Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  users  UserTenantRole[]

  @@unique([tenantId, name])
  @@index([tenantId])
  @@map("custom_roles")
}

model Invitation {
  id        String   @id @default(cuid())
  tenantId  String
  email     String
  role      String   @default("Member")
  status    String   @default("pending")
  invitedBy String
  expiresAt DateTime
  createdAt DateTime @default(now())

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, email])
  @@index([tenantId])
  @@index([email])
  @@map("invitations")
}

model Conversation {
  id           String   @id @default(cuid())
  tenantId     String
  userId       String
  title        String   @default("New Conversation")
  model        String   @default("anthropic.claude-sonnet-4-20250514")
  status       String   @default("active")
  messageCount Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  tenant    Tenant                @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  messages  Message[]
  summaries ConversationSummary[]

  @@index([tenantId])
  @@index([tenantId, userId])
  @@index([tenantId, updatedAt])
  @@map("conversations")
}

model Message {
  id             String                       @id @default(cuid())
  conversationId String
  role           String
  content        String
  tokenCount     Int?
  embedding      Unsupported("vector(1024)")?
  createdAt      DateTime                     @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId])
  @@index([conversationId, createdAt])
  @@map("messages")
}

model ConversationSummary {
  id             String   @id @default(cuid())
  conversationId String
  summary        String
  messageRange   Json
  createdAt      DateTime @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId])
  @@map("conversation_summaries")
}

model AuditLog {
  id        String   @id @default(cuid())
  tenantId  String
  eventType String
  action    String
  userId    String?
  resource  String?
  status    String   @default("success")
  severity  String   @default("info")
  metadata  Json?
  ttl       DateTime?
  createdAt DateTime @default(now())

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([tenantId, eventType])
  @@index([tenantId, createdAt])
  @@index([ttl])
  @@map("audit_logs")
}
```

- [ ] **Step 2: Start PostgreSQL and run initial migration**

Run: `cd /Users/kartik/Documents/git-repo/chatbot && docker compose up -d`
Expected: PostgreSQL container starts, health check passes.

Run: `cd /Users/kartik/Documents/git-repo/chatbot && bunx prisma migrate dev --name init --schema=./prisma/schema.prisma`
Expected: Migration created and applied. Output includes "Your database is now in sync with your schema."

- [ ] **Step 3: Verify Prisma client generation**

Run: `cd /Users/kartik/Documents/git-repo/chatbot && bunx prisma generate --schema=./prisma/schema.prisma`
Expected: "Generated Prisma Client" output.

- [ ] **Step 4: Commit**

```bash
git add prisma/
git commit -m "feat: add Prisma schema with all models and initial migration

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 3: libs/shared — Database Layer

**Files:**
- Create: `libs/shared/project.json`
- Create: `libs/shared/tsconfig.json`
- Create: `libs/shared/tsconfig.lib.json`
- Create: `libs/shared/vitest.config.ts`
- Create: `libs/shared/src/index.ts`
- Create: `libs/shared/src/db/prisma-client.ts`
- Create: `libs/shared/src/db/tenant-middleware.ts`
- Create: `libs/shared/src/db/repositories/conversation/interface.ts`
- Create: `libs/shared/src/db/repositories/conversation/postgres.ts`
- Create: `libs/shared/src/db/repositories/message/interface.ts`
- Create: `libs/shared/src/db/repositories/message/postgres.ts`
- Create: `libs/shared/src/db/repositories/audit-log/interface.ts`
- Create: `libs/shared/src/db/repositories/audit-log/postgres.ts`
- Create: `libs/shared/src/db/repositories/repository-factory.ts`
- Create: `libs/shared/src/types/domain.ts`

- [ ] **Step 1: Create libs/shared/project.json**

```json
{
  "name": "shared",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/shared/src",
  "projectType": "library",
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/libs/shared",
        "tsConfig": "libs/shared/tsconfig.lib.json",
        "main": "libs/shared/src/index.ts"
      }
    },
    "test": {
      "executor": "@nx/vite:test",
      "options": {
        "config": "libs/shared/vitest.config.ts"
      }
    }
  }
}
```

- [ ] **Step 2: Create libs/shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true
  },
  "files": [],
  "include": [],
  "references": [
    { "path": "./tsconfig.lib.json" }
  ]
}
```

- [ ] **Step 3: Create libs/shared/tsconfig.lib.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/libs/shared",
    "declaration": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 4: Create libs/shared/vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 5: Create libs/shared/src/types/domain.ts**

```typescript
export type ConversationStatus = 'active' | 'archived';
export type MessageRole = 'user' | 'assistant' | 'system';
export type AuditSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
```

- [ ] **Step 6: Create libs/shared/src/db/prisma-client.ts**

```typescript
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined;
}

let prismaClient: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  if (process.env.NODE_ENV === 'production') {
    if (!prismaClient) {
      prismaClient = new PrismaClient({ log: ['error'] });
    }
    return prismaClient;
  }

  if (!globalThis.__prismaClient) {
    globalThis.__prismaClient = new PrismaClient({ log: ['query', 'error', 'warn'] });
  }
  return globalThis.__prismaClient;
}

export async function disconnectPrisma(): Promise<void> {
  const client = prismaClient ?? globalThis.__prismaClient;
  if (client) {
    await client.$disconnect();
  }
}
```

- [ ] **Step 7: Create libs/shared/src/db/tenant-middleware.ts**

```typescript
import { getPrismaClient } from './prisma-client';

export const TENANT_SCOPED_MODELS = new Set([
  'Conversation',
  'AuditLog',
  'CustomRole',
  'UserTenantRole',
  'TenantConfig',
  'Invitation',
]);

export function getTenantClient(tenantId: string) {
  if (!tenantId) throw new Error('getTenantClient: tenantId is required');
  const base = getPrismaClient();
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model: string | undefined;
          operation: string;
          args: Record<string, any>;
          query: (args: Record<string, any>) => Promise<unknown>;
        }) {
          if (!TENANT_SCOPED_MODELS.has(model ?? '')) {
            return query(args);
          }

          if (
            [
              'findMany',
              'findFirst',
              'findUnique',
              'findUniqueOrThrow',
              'count',
              'aggregate',
              'groupBy',
            ].includes(operation)
          ) {
            args = { ...args, where: { ...args.where, tenantId } };
          }

          if (operation === 'create') {
            args = { ...args, data: { ...args.data, tenantId } };
          }

          if (operation === 'createMany') {
            if (Array.isArray(args.data)) {
              args = {
                ...args,
                data: args.data.map((d: Record<string, unknown>) => ({ ...d, tenantId })),
              };
            } else {
              args = { ...args, data: { ...args.data, tenantId } };
            }
          }

          if (operation === 'upsert') {
            args = {
              ...args,
              where: { ...args.where, tenantId },
              create: { ...args.create, tenantId },
            };
          }

          if (['update', 'updateMany'].includes(operation)) {
            args = { ...args, where: { ...args.where, tenantId } };
          }

          if (['delete', 'deleteMany'].includes(operation)) {
            args = { ...args, where: { ...args.where, tenantId } };
          }

          return query(args);
        },
      },
    },
  });
}
```

- [ ] **Step 8: Create libs/shared/src/db/repositories/conversation/interface.ts**

```typescript
import type { PaginationParams, PaginatedResult } from '../../../types/domain';

export interface ConversationRecord {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  model: string;
  status: string;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateConversationInput {
  userId: string;
  title?: string;
  model?: string;
}

export interface UpdateConversationInput {
  title?: string;
  status?: string;
  model?: string;
  messageCount?: number;
}

export interface ConversationRepository {
  findById(id: string): Promise<ConversationRecord | null>;
  findByUserId(userId: string, params?: PaginationParams): Promise<PaginatedResult<ConversationRecord>>;
  create(input: CreateConversationInput): Promise<ConversationRecord>;
  update(id: string, input: UpdateConversationInput): Promise<ConversationRecord>;
  delete(id: string): Promise<void>;
}
```

- [ ] **Step 9: Create libs/shared/src/db/repositories/conversation/postgres.ts**

```typescript
import type {
  ConversationRepository,
  ConversationRecord,
  CreateConversationInput,
  UpdateConversationInput,
} from './interface';
import type { PaginationParams, PaginatedResult } from '../../../types/domain';

export class PostgresConversationRepository implements ConversationRepository {
  constructor(private readonly db: any) {}

  async findById(id: string): Promise<ConversationRecord | null> {
    return this.db.conversation.findUnique({ where: { id } });
  }

  async findByUserId(
    userId: string,
    params: PaginationParams = {},
  ): Promise<PaginatedResult<ConversationRecord>> {
    const { limit = 20, offset = 0 } = params;
    const [items, total] = await Promise.all([
      this.db.conversation.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.db.conversation.count({ where: { userId } }),
    ]);
    return { items, total, limit, offset };
  }

  async create(input: CreateConversationInput): Promise<ConversationRecord> {
    return this.db.conversation.create({ data: input });
  }

  async update(id: string, input: UpdateConversationInput): Promise<ConversationRecord> {
    return this.db.conversation.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.db.conversation.delete({ where: { id } });
  }
}
```

- [ ] **Step 10: Create libs/shared/src/db/repositories/message/interface.ts**

```typescript
export interface MessageRecord {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  tokenCount: number | null;
  createdAt: Date;
}

export interface CreateMessageInput {
  conversationId: string;
  role: string;
  content: string;
  tokenCount?: number;
}

export interface MessageRepository {
  findByConversationId(conversationId: string, limit?: number): Promise<MessageRecord[]>;
  create(input: CreateMessageInput): Promise<MessageRecord>;
  updateEmbedding(id: string, embedding: number[]): Promise<void>;
}
```

- [ ] **Step 11: Create libs/shared/src/db/repositories/message/postgres.ts**

```typescript
import type { MessageRepository, MessageRecord, CreateMessageInput } from './interface';

export class PostgresMessageRepository implements MessageRepository {
  constructor(private readonly db: any) {}

  async findByConversationId(conversationId: string, limit = 50): Promise<MessageRecord[]> {
    return this.db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        conversationId: true,
        role: true,
        content: true,
        tokenCount: true,
        createdAt: true,
      },
    });
  }

  async create(input: CreateMessageInput): Promise<MessageRecord> {
    return this.db.message.create({ data: input });
  }

  async updateEmbedding(id: string, embedding: number[]): Promise<void> {
    const vectorStr = `[${embedding.join(',')}]`;
    await this.db.$executeRawUnsafe(
      `UPDATE messages SET embedding = $1::vector WHERE id = $2`,
      vectorStr,
      id,
    );
  }
}
```

- [ ] **Step 12: Create libs/shared/src/db/repositories/audit-log/interface.ts**

```typescript
import type { PaginationParams, PaginatedResult } from '../../../types/domain';

export interface AuditLogRecord {
  id: string;
  tenantId: string;
  eventType: string;
  action: string;
  userId: string | null;
  resource: string | null;
  status: string;
  severity: string;
  metadata: any;
  createdAt: Date;
}

export interface CreateAuditLogInput {
  eventType: string;
  action: string;
  userId?: string;
  resource?: string;
  status?: string;
  severity?: string;
  metadata?: Record<string, unknown>;
  ttl?: Date;
}

export interface AuditLogFilters {
  eventType?: string;
  severity?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface AuditLogRepository {
  findAll(filters?: AuditLogFilters, params?: PaginationParams): Promise<PaginatedResult<AuditLogRecord>>;
  create(input: CreateAuditLogInput): Promise<AuditLogRecord>;
}
```

- [ ] **Step 13: Create libs/shared/src/db/repositories/audit-log/postgres.ts**

```typescript
import type {
  AuditLogRepository,
  AuditLogRecord,
  CreateAuditLogInput,
  AuditLogFilters,
} from './interface';
import type { PaginationParams, PaginatedResult } from '../../../types/domain';

export class PostgresAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: any) {}

  async findAll(
    filters: AuditLogFilters = {},
    params: PaginationParams = {},
  ): Promise<PaginatedResult<AuditLogRecord>> {
    const { limit = 50, offset = 0 } = params;
    const where: Record<string, unknown> = {};

    if (filters.eventType) where.eventType = filters.eventType;
    if (filters.severity) where.severity = filters.severity;
    if (filters.startDate || filters.endDate) {
      where.createdAt = {
        ...(filters.startDate ? { gte: filters.startDate } : {}),
        ...(filters.endDate ? { lte: filters.endDate } : {}),
      };
    }

    const [items, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.db.auditLog.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  async create(input: CreateAuditLogInput): Promise<AuditLogRecord> {
    return this.db.auditLog.create({ data: input });
  }
}
```

- [ ] **Step 14: Create libs/shared/src/db/repositories/repository-factory.ts**

```typescript
import { PostgresConversationRepository } from './conversation/postgres';
import { PostgresMessageRepository } from './message/postgres';
import { PostgresAuditLogRepository } from './audit-log/postgres';
import type { ConversationRepository } from './conversation/interface';
import type { MessageRepository } from './message/interface';
import type { AuditLogRepository } from './audit-log/interface';

export function createConversationRepository(db: any): ConversationRepository {
  return new PostgresConversationRepository(db);
}

export function createMessageRepository(db: any): MessageRepository {
  return new PostgresMessageRepository(db);
}

export function createAuditLogRepository(db: any): AuditLogRepository {
  return new PostgresAuditLogRepository(db);
}
```

- [ ] **Step 15: Create initial barrel export libs/shared/src/index.ts**

```typescript
export { getPrismaClient, disconnectPrisma } from './db/prisma-client';
export { getTenantClient, TENANT_SCOPED_MODELS } from './db/tenant-middleware';
export {
  createConversationRepository,
  createMessageRepository,
  createAuditLogRepository,
} from './db/repositories/repository-factory';
export type { ConversationRepository, ConversationRecord, CreateConversationInput, UpdateConversationInput } from './db/repositories/conversation/interface';
export type { MessageRepository, MessageRecord, CreateMessageInput } from './db/repositories/message/interface';
export type { AuditLogRepository, AuditLogRecord, CreateAuditLogInput, AuditLogFilters } from './db/repositories/audit-log/interface';
export type { PaginationParams, PaginatedResult, ConversationStatus, MessageRole, AuditSeverity, InvitationStatus } from './types/domain';
```

- [ ] **Step 16: Commit**

```bash
git add libs/shared/
git commit -m "feat: add shared lib with Prisma client, tenant middleware, and repositories

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 4: libs/shared — Auth, RBAC & Services

**Files:**
- Create: `libs/shared/src/auth/types.ts`
- Create: `libs/shared/src/auth/auth-session.ts`
- Create: `libs/shared/src/auth/auth-options.ts`
- Create: `libs/shared/src/rbac/types.ts`
- Create: `libs/shared/src/rbac/permissions.ts`
- Create: `libs/shared/src/rbac/authorize.ts`
- Create: `libs/shared/src/services/audit-service.ts`
- Create: `libs/shared/src/services/conversation-service.ts`
- Create: `libs/shared/src/services/message-service.ts`
- Create: `libs/shared/src/services/tenant-config-service.ts`

- [ ] **Step 1: Create libs/shared/src/auth/types.ts**

```typescript
import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      tenantId?: string | null;
      role?: string | null;
      isSuperAdmin?: boolean;
    };
  }

  interface User {
    id: string;
    email: string;
    isSuperAdmin?: boolean;
    activeTenantId?: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    tenantId?: string | null;
    role?: string | null;
    isSuperAdmin?: boolean;
  }
}
```

- [ ] **Step 2: Create libs/shared/src/auth/auth-session.ts**

```typescript
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

export async function getSessionTenantId(authOptions: any): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error('Unauthenticated: no valid session');
  }
  if (!session.user.tenantId) {
    throw new Error('Unauthorized: no tenant associated with session');
  }
  return session.user.tenantId;
}

export async function getSessionUserId(authOptions: any): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('Unauthenticated: no valid session');
  }
  return session.user.id;
}

export async function assertSuperAdmin(authOptions: any): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Unauthenticated', message: 'No valid session' },
      { status: 401 },
    );
  }
  if (session.user.isSuperAdmin !== true) {
    return NextResponse.json(
      { error: 'Forbidden', message: 'Super admin access required' },
      { status: 403 },
    );
  }
  return null;
}
```

- [ ] **Step 3: Create libs/shared/src/auth/auth-options.ts**

```typescript
import { NextAuthOptions } from 'next-auth';
import CognitoProvider from 'next-auth/providers/cognito';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { getPrismaClient } from '../db/prisma-client';

export function createAuthOptions(overrides?: Partial<NextAuthOptions>): NextAuthOptions {
  const prisma = getPrismaClient();

  const prismaForAuth = {
    user: prisma.authUser,
    account: prisma.authAccount,
    session: prisma.authSession,
    verificationToken: prisma.verificationToken,
  };

  return {
    adapter: PrismaAdapter(prismaForAuth as any),
    session: { strategy: 'jwt', maxAge: 24 * 60 * 60 },
    providers: [
      CredentialsProvider({
        id: 'credentials',
        name: 'Credentials',
        credentials: {
          email: { label: 'Email', type: 'email' },
          password: { label: 'Password', type: 'password' },
        },
        async authorize(credentials) {
          if (!credentials?.email || !credentials?.password) return null;
          const user = await prisma.authUser.findUnique({
            where: { email: credentials.email as string },
          });
          if (!user || !user.passwordHash) return null;

          const bcrypt = await import('bcryptjs');
          const valid = await bcrypt.compare(credentials.password as string, user.passwordHash);
          if (!valid) return null;

          return { id: user.id, email: user.email, isSuperAdmin: user.isSuperAdmin };
        },
      }),
      ...(process.env.COGNITO_APP_CLIENT_ID
        ? [
            CognitoProvider({
              clientId: process.env.COGNITO_APP_CLIENT_ID,
              clientSecret: process.env.COGNITO_APP_CLIENT_SECRET!,
              issuer: process.env.COGNITO_ISSUER!,
              allowDangerousEmailAccountLinking: true,
            }),
          ]
        : []),
    ],
    pages: { signIn: '/login', error: '/login' },
    callbacks: {
      async jwt({ token, user, trigger }) {
        if (user || trigger === 'update') {
          const userId = user?.id ?? (token.sub as string);
          const utr = await prisma.userTenantRole.findFirst({
            where: { userId },
            orderBy: { assignedAt: 'desc' },
          });
          token.tenantId = utr?.tenantId ?? null;
          token.role = utr?.role ?? null;
          if (user) {
            token.isSuperAdmin = (user as any).isSuperAdmin ?? false;
          }
        }
        return token;
      },
      async session({ session, token }) {
        if (session.user) {
          session.user.id = token.sub!;
          session.user.tenantId = token.tenantId as string | undefined;
          session.user.role = token.role as string | undefined;
          session.user.isSuperAdmin = token.isSuperAdmin as boolean | undefined;
        }
        return session;
      },
    },
    ...overrides,
  };
}
```

- [ ] **Step 4: Create libs/shared/src/rbac/types.ts**

```typescript
export type Module = 'Chat' | 'Conversations' | 'Settings';
export type Action = 'create' | 'read' | 'update' | 'delete';
export type PredefinedRole = 'Owner' | 'Admin' | 'Member' | 'Viewer';
export type RoleLevel = 1 | 2 | 3 | 4;
export type PermissionSet = Record<Module, Action[]>;

export const SUBJECT_TO_MODULE: Record<string, Module> = {
  Chat: 'Chat',
  Conversation: 'Conversations',
  Setting: 'Settings',
  Tenant: 'Settings',
  User: 'Settings',
  Role: 'Settings',
  AuditLog: 'Conversations',
};

export const ACTION_MAP: Record<string, Action | Action[]> = {
  manage: ['create', 'read', 'update', 'delete'],
  create: 'create',
  read: 'read',
  update: 'update',
  delete: 'delete',
};
```

- [ ] **Step 5: Create libs/shared/src/rbac/permissions.ts**

```typescript
import type { Module, Action, PredefinedRole, RoleLevel, PermissionSet } from './types';

export const ROLE_PERMISSIONS: Record<PredefinedRole, PermissionSet> = {
  Owner: {
    Chat: ['create', 'read', 'update', 'delete'],
    Conversations: ['create', 'read', 'update', 'delete'],
    Settings: ['create', 'read', 'update', 'delete'],
  },
  Admin: {
    Chat: ['create', 'read', 'update', 'delete'],
    Conversations: ['create', 'read', 'update', 'delete'],
    Settings: ['create', 'read', 'update'],
  },
  Member: {
    Chat: ['create', 'read'],
    Conversations: ['create', 'read'],
    Settings: ['read'],
  },
  Viewer: {
    Chat: ['read'],
    Conversations: ['read'],
    Settings: ['read'],
  },
};

export const ROLE_LEVELS: Record<PredefinedRole, RoleLevel> = {
  Owner: 4,
  Admin: 3,
  Member: 2,
  Viewer: 1,
};

export function hasPermission(role: PredefinedRole, action: Action, module: Module): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return perms[module]?.includes(action) ?? false;
}

export function hasCustomPermission(
  permissions: PermissionSet,
  action: Action,
  module: Module,
): boolean {
  return permissions[module]?.includes(action) ?? false;
}
```

- [ ] **Step 6: Create libs/shared/src/rbac/authorize.ts**

```typescript
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { SUBJECT_TO_MODULE, ACTION_MAP, type Module, type Action, type PredefinedRole } from './types';
import { hasPermission } from './permissions';

const PREDEFINED_ROLES = new Set<string>(['Owner', 'Admin', 'Member', 'Viewer']);

export async function authorize(
  action: string,
  subjectType: string,
  authOptions: any,
): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { error: 'Unauthenticated', message: 'No valid session' },
      { status: 401 },
    );
  }

  if (session.user.isSuperAdmin === true) return null;

  const role = session.user.role;
  if (!role) {
    return NextResponse.json(
      { error: 'Forbidden', message: `No permission to ${action} ${subjectType}` },
      { status: 403 },
    );
  }

  const module: Module = SUBJECT_TO_MODULE[subjectType] ?? (subjectType as Module);
  const mappedAction = ACTION_MAP[action];
  const actionsToCheck: Action[] = Array.isArray(mappedAction)
    ? mappedAction
    : [mappedAction ?? (action as Action)];

  let permitted = false;
  if (PREDEFINED_ROLES.has(role)) {
    permitted = actionsToCheck.some((a) => hasPermission(role as PredefinedRole, a, module));
  }

  if (!permitted) {
    return NextResponse.json(
      { error: 'Forbidden', message: `No permission to ${action} ${subjectType}` },
      { status: 403 },
    );
  }

  return null;
}
```

- [ ] **Step 7: Create libs/shared/src/services/audit-service.ts**

```typescript
import { createAuditLogRepository } from '../db/repositories/repository-factory';
import { getTenantClient } from '../db/tenant-middleware';
import type { CreateAuditLogInput } from '../db/repositories/audit-log/interface';

export class AuditService {
  static async log(tenantId: string, input: CreateAuditLogInput): Promise<void> {
    try {
      const db = getTenantClient(tenantId);
      const repo = createAuditLogRepository(db);
      await repo.create(input);
    } catch (error) {
      console.error('AuditService.log failed:', error);
    }
  }
}
```

- [ ] **Step 8: Create libs/shared/src/services/conversation-service.ts**

```typescript
import { createConversationRepository } from '../db/repositories/repository-factory';
import { getTenantClient } from '../db/tenant-middleware';
import type { CreateConversationInput, UpdateConversationInput } from '../db/repositories/conversation/interface';
import type { PaginationParams } from '../types/domain';

export class ConversationService {
  private readonly db: any;
  private readonly repo: ReturnType<typeof createConversationRepository>;

  constructor(tenantId: string) {
    this.db = getTenantClient(tenantId);
    this.repo = createConversationRepository(this.db);
  }

  findById(id: string) {
    return this.repo.findById(id);
  }

  findByUserId(userId: string, params?: PaginationParams) {
    return this.repo.findByUserId(userId, params);
  }

  create(input: CreateConversationInput) {
    return this.repo.create(input);
  }

  update(id: string, input: UpdateConversationInput) {
    return this.repo.update(id, input);
  }

  delete(id: string) {
    return this.repo.delete(id);
  }
}
```

- [ ] **Step 9: Create libs/shared/src/services/message-service.ts**

```typescript
import { createMessageRepository } from '../db/repositories/repository-factory';
import { getTenantClient } from '../db/tenant-middleware';
import type { CreateMessageInput } from '../db/repositories/message/interface';

export class MessageService {
  private readonly db: any;
  private readonly repo: ReturnType<typeof createMessageRepository>;

  constructor(tenantId: string) {
    this.db = getTenantClient(tenantId);
    this.repo = createMessageRepository(this.db);
  }

  findByConversationId(conversationId: string, limit?: number) {
    return this.repo.findByConversationId(conversationId, limit);
  }

  create(input: CreateMessageInput) {
    return this.repo.create(input);
  }

  updateEmbedding(id: string, embedding: number[]) {
    return this.repo.updateEmbedding(id, embedding);
  }
}
```

- [ ] **Step 10: Create libs/shared/src/services/tenant-config-service.ts**

```typescript
import { getTenantClient } from '../db/tenant-middleware';

export class TenantConfigService {
  private readonly db: any;

  constructor(tenantId: string) {
    this.db = getTenantClient(tenantId);
  }

  async get<T = any>(key: string): Promise<T | null> {
    const config = await this.db.tenantConfig.findFirst({ where: { configKey: key } });
    return config?.data as T | null;
  }

  async set(key: string, value: any, updatedBy = 'system'): Promise<void> {
    await this.db.tenantConfig.upsert({
      where: { tenantId_configKey: { tenantId: '', configKey: key } },
      create: { configKey: key, data: value, updatedBy },
      update: { data: value, updatedBy },
    });
  }
}
```

- [ ] **Step 11: Update libs/shared/src/index.ts barrel with auth, rbac, services**

Add to the existing barrel:

```typescript
// Auth
export { getSessionTenantId, getSessionUserId, assertSuperAdmin } from './auth/auth-session';
export { createAuthOptions } from './auth/auth-options';
export './auth/types';

// RBAC
export { authorize } from './rbac/authorize';
export { hasPermission, hasCustomPermission, ROLE_PERMISSIONS, ROLE_LEVELS } from './rbac/permissions';
export type { Module, Action, PredefinedRole, PermissionSet } from './rbac/types';

// Services
export { AuditService } from './services/audit-service';
export { ConversationService } from './services/conversation-service';
export { MessageService } from './services/message-service';
export { TenantConfigService } from './services/tenant-config-service';
```

- [ ] **Step 12: Commit**

```bash
git add libs/shared/src/auth/ libs/shared/src/rbac/ libs/shared/src/services/ libs/shared/src/index.ts
git commit -m "feat: add auth, RBAC, and service layers to shared lib

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 5: libs/ai — Bedrock Integration

**Files:**
- Create: `libs/ai/project.json`
- Create: `libs/ai/tsconfig.json`
- Create: `libs/ai/tsconfig.lib.json`
- Create: `libs/ai/vitest.config.ts`
- Create: `libs/ai/src/index.ts`
- Create: `libs/ai/src/bedrock-client.ts`
- Create: `libs/ai/src/chat-completion.ts`
- Create: `libs/ai/src/embeddings.ts`

- [ ] **Step 1: Create libs/ai/project.json**

```json
{
  "name": "ai",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/ai/src",
  "projectType": "library",
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/libs/ai",
        "tsConfig": "libs/ai/tsconfig.lib.json",
        "main": "libs/ai/src/index.ts"
      }
    },
    "test": {
      "executor": "@nx/vite:test",
      "options": {
        "config": "libs/ai/vitest.config.ts"
      }
    }
  }
}
```

- [ ] **Step 2: Create libs/ai/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true
  },
  "files": [],
  "include": [],
  "references": [
    { "path": "./tsconfig.lib.json" }
  ]
}
```

- [ ] **Step 3: Create libs/ai/tsconfig.lib.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/libs/ai",
    "declaration": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 4: Create libs/ai/vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 5: Create libs/ai/src/bedrock-client.ts**

```typescript
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

let bedrockInstance: ReturnType<typeof createAmazonBedrock> | undefined;

export function getBedrockProvider() {
  if (!bedrockInstance) {
    bedrockInstance = createAmazonBedrock({
      region: process.env.AWS_REGION ?? 'ap-south-1',
    });
  }
  return bedrockInstance;
}

export const DEFAULT_MODEL = 'anthropic.claude-sonnet-4-20250514';
```

- [ ] **Step 6: Create libs/ai/src/chat-completion.ts**

```typescript
import { streamText, type CoreMessage } from 'ai';
import { getBedrockProvider, DEFAULT_MODEL } from './bedrock-client';

export interface StreamChatOptions {
  messages: CoreMessage[];
  model?: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  onFinish?: (result: { text: string; usage: { promptTokens: number; completionTokens: number } }) => void | Promise<void>;
}

export function streamChat(options: StreamChatOptions) {
  const { messages, model, system, temperature = 0.7, maxTokens = 4096, onFinish } = options;
  const bedrock = getBedrockProvider();

  return streamText({
    model: bedrock(model ?? DEFAULT_MODEL),
    messages,
    system,
    temperature,
    maxTokens,
    onFinish,
  });
}
```

- [ ] **Step 7: Create libs/ai/src/embeddings.ts**

```typescript
import { embedMany, embed } from 'ai';
import { getBedrockProvider } from './bedrock-client';

const EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';

export async function generateEmbedding(text: string): Promise<number[]> {
  const bedrock = getBedrockProvider();
  const { embedding } = await embed({
    model: bedrock.textEmbeddingModel(EMBEDDING_MODEL),
    value: text,
  });
  return embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const bedrock = getBedrockProvider();
  const { embeddings } = await embedMany({
    model: bedrock.textEmbeddingModel(EMBEDDING_MODEL),
    values: texts,
  });
  return embeddings;
}
```

- [ ] **Step 8: Create libs/ai/src/index.ts**

```typescript
export { getBedrockProvider, DEFAULT_MODEL } from './bedrock-client';
export { streamChat, type StreamChatOptions } from './chat-completion';
export { generateEmbedding, generateEmbeddings } from './embeddings';
```

- [ ] **Step 9: Install AI dependencies in root package.json**

Run: `bun add ai @ai-sdk/amazon-bedrock`
Expected: Packages installed successfully.

- [ ] **Step 10: Commit**

```bash
git add libs/ai/
git commit -m "feat: add AI lib with Bedrock client, streaming chat, and embeddings

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 6: apps/web-ui — Next.js Scaffolding & Config

**Files:**
- Create: `apps/web-ui/project.json`
- Create: `apps/web-ui/package.json`
- Create: `apps/web-ui/tsconfig.json`
- Create: `apps/web-ui/next.config.ts`
- Create: `apps/web-ui/tailwind.config.ts`
- Create: `apps/web-ui/postcss.config.js`
- Create: `apps/web-ui/.env.local.example`
- Create: `apps/web-ui/app/globals.css`
- Create: `apps/web-ui/app/layout.tsx`
- Create: `apps/web-ui/app/page.tsx`
- Create: `apps/web-ui/lib/utils.ts`
- Create: `apps/web-ui/middleware.ts`

- [ ] **Step 1: Create apps/web-ui/project.json**

```json
{
  "name": "web-ui",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "apps/web-ui",
  "projectType": "application",
  "targets": {
    "build": {
      "executor": "@nx/next:build",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/apps/web-ui"
      }
    },
    "serve": {
      "executor": "@nx/next:server",
      "options": {
        "buildTarget": "web-ui:build",
        "dev": true,
        "port": 3001
      }
    },
    "test": {
      "executor": "@nx/vite:test",
      "options": {
        "config": "apps/web-ui/vitest.config.ts"
      }
    }
  }
}
```

- [ ] **Step 2: Create apps/web-ui/package.json**

```json
{
  "name": "@chatbot/web-ui",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "test": "vitest run"
  },
  "dependencies": {
    "@auth/prisma-adapter": "^2.8.0",
    "@prisma/client": "^6.0.0",
    "@radix-ui/react-avatar": "^1.1.0",
    "@radix-ui/react-dialog": "^1.1.0",
    "@radix-ui/react-dropdown-menu": "^2.1.0",
    "@radix-ui/react-scroll-area": "^1.2.0",
    "@radix-ui/react-slot": "^1.1.0",
    "@radix-ui/react-toast": "^1.2.0",
    "ai": "^5.0.0",
    "@ai-sdk/amazon-bedrock": "^2.0.0",
    "bcryptjs": "^2.4.3",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "lucide-react": "^0.400.0",
    "next": "^15.2.0",
    "next-auth": "^4.24.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^9.0.0",
    "tailwind-merge": "^2.5.0",
    "tailwindcss-animate": "^1.0.7"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Create apps/web-ui/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "noEmit": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"],
      "@chatbot/shared": ["../../libs/shared/src/index.ts"],
      "@chatbot/ai": ["../../libs/ai/src/index.ts"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create apps/web-ui/next.config.ts**

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@chatbot/shared', '@chatbot/ai'],
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'bcryptjs'],
  },
};

export default nextConfig;
```

- [ ] **Step 5: Create apps/web-ui/tailwind.config.ts**

```typescript
import type { Config } from 'tailwindcss';
import tailwindAnimate from 'tailwindcss-animate';

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [tailwindAnimate],
};

export default config;
```

- [ ] **Step 6: Create apps/web-ui/postcss.config.js**

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 7: Create apps/web-ui/.env.local.example**

```bash
# Auth
NEXTAUTH_URL=http://localhost:3001
NEXTAUTH_SECRET=your-secret-here

# Database
DATABASE_URL="postgresql://chatbot_admin:chatbot_dev@localhost:5432/chatbot?schema=public"

# Cognito (optional — credentials auth works without these)
COGNITO_APP_CLIENT_ID=
COGNITO_APP_CLIENT_SECRET=
COGNITO_ISSUER=

# AWS Bedrock
AWS_REGION=ap-south-1
```

- [ ] **Step 8: Create apps/web-ui/lib/utils.ts**

```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 9: Create apps/web-ui/app/globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

- [ ] **Step 10: Create apps/web-ui/app/layout.tsx**

```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Chatbot',
  description: 'AI-powered chatbot application',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
```

- [ ] **Step 11: Create apps/web-ui/app/page.tsx**

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/chat');
}
```

- [ ] **Step 12: Create apps/web-ui/middleware.ts**

```typescript
import { withAuth, NextRequestWithAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req: NextRequestWithAuth) {
    const token = req.nextauth.token;
    const { pathname } = req.nextUrl;

    const skipNoTenantRedirect =
      pathname === '/create-org' ||
      pathname.startsWith('/api/') ||
      pathname === '/login' ||
      pathname === '/register' ||
      pathname === '/';

    if (!skipNoTenantRedirect && token && !token.tenantId) {
      return NextResponse.redirect(new URL('/create-org', req.url));
    }

    const requestHeaders = new Headers(req.headers);
    if (token?.tenantId) {
      requestHeaders.set('x-tenant-id', token.tenantId as string);
    }

    return NextResponse.next({ request: { headers: requestHeaders } });
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const { pathname } = req.nextUrl;
        if (pathname === '/login' || pathname === '/register' || pathname === '/') {
          return true;
        }
        return !!token;
      },
    },
  },
);

export const config = {
  matcher: [
    '/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|login|register).*)',
  ],
};
```

- [ ] **Step 13: Install web-ui dependencies**

Run: `cd /Users/kartik/Documents/git-repo/chatbot/apps/web-ui && bun install`
Expected: Dependencies install successfully.

- [ ] **Step 14: Commit**

```bash
git add apps/web-ui/project.json apps/web-ui/package.json apps/web-ui/tsconfig.json apps/web-ui/next.config.ts apps/web-ui/tailwind.config.ts apps/web-ui/postcss.config.js apps/web-ui/.env.local.example apps/web-ui/app/ apps/web-ui/lib/ apps/web-ui/middleware.ts
git commit -m "feat: scaffold Next.js web-ui app with Tailwind, auth middleware, and root layout

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 7: apps/web-ui — UI Components

**Files:**
- Create: `apps/web-ui/components/ui/button.tsx`
- Create: `apps/web-ui/components/ui/input.tsx`
- Create: `apps/web-ui/components/ui/dialog.tsx`
- Create: `apps/web-ui/components/ui/dropdown-menu.tsx`
- Create: `apps/web-ui/components/ui/scroll-area.tsx`
- Create: `apps/web-ui/components/ui/avatar.tsx`
- Create: `apps/web-ui/components/ui/toast.tsx`
- Create: `apps/web-ui/components/chat/chat-bubble.tsx`
- Create: `apps/web-ui/components/chat/chat-messages.tsx`
- Create: `apps/web-ui/components/chat/chat-input.tsx`
- Create: `apps/web-ui/components/layout/sidebar.tsx`
- Create: `apps/web-ui/components/layout/layout-wrapper.tsx`
- Create: `apps/web-ui/components/layout/auth-guard.tsx`
- Create: `apps/web-ui/lib/hooks/use-chat-scroll.ts`

- [ ] **Step 1: Create apps/web-ui/components/ui/button.tsx**

```tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
```

- [ ] **Step 2: Create apps/web-ui/components/ui/input.tsx**

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
```

- [ ] **Step 3: Create apps/web-ui/components/ui/dialog.tsx**

```tsx
'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0', className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn('fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg', className)}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
);

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-lg font-semibold leading-none tracking-tight', className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogClose };
```

- [ ] **Step 4: Create apps/web-ui/components/ui/dropdown-menu.tsx**

```tsx
'use client';

import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn('z-50 min-w-[8rem] overflow-hidden rounded-md border bg-background p-1 text-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95', className)}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn('relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50', className)}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-muted', className)} {...props} />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator };
```

- [ ] **Step 5: Create apps/web-ui/components/ui/scroll-area.tsx**

```tsx
'use client';

import * as React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { cn } from '@/lib/utils';

const ScrollArea = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root ref={ref} className={cn('relative overflow-hidden', className)} {...props}>
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollAreaPrimitive.ScrollAreaScrollbar orientation="vertical" className="flex touch-none select-none transition-colors h-full w-2.5 border-l border-l-transparent p-[1px]">
      <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
));
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

export { ScrollArea };
```

- [ ] **Step 6: Create apps/web-ui/components/ui/avatar.tsx**

```tsx
'use client';

import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from '@/lib/utils';

const Avatar = React.forwardRef<
  React.ComponentRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root ref={ref} className={cn('relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full', className)} {...props} />
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarFallback = React.forwardRef<
  React.ComponentRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback ref={ref} className={cn('flex h-full w-full items-center justify-center rounded-full bg-muted', className)} {...props} />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarFallback };
```

- [ ] **Step 7: Create apps/web-ui/components/ui/toast.tsx**

```tsx
'use client';

import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { cn } from '@/lib/utils';

const ToastProvider = ToastPrimitive.Provider;

const ToastViewport = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn('fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]', className)}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitive.Viewport.displayName;

const Toast = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Root
    ref={ref}
    className={cn('group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=open]:slide-in-from-top-full', className)}
    {...props}
  />
));
Toast.displayName = ToastPrimitive.Root.displayName;

const ToastTitle = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title ref={ref} className={cn('text-sm font-semibold', className)} {...props} />
));
ToastTitle.displayName = ToastPrimitive.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description ref={ref} className={cn('text-sm opacity-90', className)} {...props} />
));
ToastDescription.displayName = ToastPrimitive.Description.displayName;

export { ToastProvider, ToastViewport, Toast, ToastTitle, ToastDescription };
```

- [ ] **Step 8: Create apps/web-ui/lib/hooks/use-chat-scroll.ts**

```typescript
import { useEffect, useRef } from 'react';

export function useChatScroll<T>(dep: T) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [dep]);

  return ref;
}
```

- [ ] **Step 9: Create apps/web-ui/components/chat/chat-bubble.tsx**

```tsx
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import ReactMarkdown from 'react-markdown';

interface ChatBubbleProps {
  role: 'user' | 'assistant';
  content: string;
}

export function ChatBubble({ role, content }: ChatBubbleProps) {
  const isUser = role === 'user';

  return (
    <div className={cn('flex gap-3 p-4', isUser && 'flex-row-reverse')}>
      <Avatar className="h-8 w-8">
        <AvatarFallback className={cn(isUser ? 'bg-primary text-primary-foreground' : 'bg-secondary')}>
          {isUser ? 'U' : 'AI'}
        </AvatarFallback>
      </Avatar>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-4 py-2 text-sm',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <ReactMarkdown className="prose prose-sm dark:prose-invert max-w-none">
            {content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Create apps/web-ui/components/chat/chat-messages.tsx**

```tsx
'use client';

import type { Message } from 'ai';
import { ChatBubble } from './chat-bubble';
import { useChatScroll } from '@/lib/hooks/use-chat-scroll';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ChatMessagesProps {
  messages: Message[];
  isLoading?: boolean;
}

export function ChatMessages({ messages, isLoading }: ChatMessagesProps) {
  const scrollRef = useChatScroll(messages);

  return (
    <ScrollArea className="flex-1" ref={scrollRef}>
      <div className="flex flex-col">
        {messages.map((message) => (
          <ChatBubble key={message.id} role={message.role as 'user' | 'assistant'} content={message.content} />
        ))}
        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex gap-3 p-4">
            <div className="h-8 w-8 rounded-full bg-secondary animate-pulse" />
            <div className="max-w-[80%] rounded-lg bg-muted px-4 py-2">
              <div className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0.2s]" />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
```

- [ ] **Step 11: Create apps/web-ui/components/chat/chat-input.tsx**

```tsx
'use client';

import { useRef, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { SendHorizontal } from 'lucide-react';

interface ChatInputProps {
  input: string;
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleSubmit: (e: FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
}

export function ChatInput({ input, handleInputChange, handleSubmit, isLoading }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const form = e.currentTarget.closest('form');
      if (form && input.trim()) form.requestSubmit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t p-4">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={handleInputChange}
        onKeyDown={onKeyDown}
        placeholder="Type a message..."
        disabled={isLoading}
        rows={1}
        className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
      <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
        <SendHorizontal className="h-4 w-4" />
      </Button>
    </form>
  );
}
```

- [ ] **Step 12: Create apps/web-ui/components/layout/auth-guard.tsx**

```tsx
'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (status === 'authenticated') {
    return <>{children}</>;
  }

  return null;
}
```

- [ ] **Step 13: Create apps/web-ui/components/layout/sidebar.tsx**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, History, Settings, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const navItems = [
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/conversations', label: 'History', icon: History },
  { href: '/settings', label: 'Settings', icon: Settings },
];

interface SidebarProps {
  conversations?: { id: string; title: string }[];
  onNewChat?: () => void;
}

export function Sidebar({ conversations = [], onNewChat }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-muted/40">
      <div className="flex items-center justify-between border-b p-4">
        <h1 className="text-lg font-semibold">Chatbot</h1>
        <Button variant="ghost" size="icon" onClick={onNewChat} aria-label="New chat">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
              pathname === item.href && 'bg-accent text-accent-foreground',
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>
      {conversations.length > 0 && (
        <div className="border-t p-2">
          <p className="px-3 py-1 text-xs font-medium text-muted-foreground">Recent</p>
          {conversations.slice(0, 10).map((conv) => (
            <Link
              key={conv.id}
              href={`/chat?id=${conv.id}`}
              className="block truncate rounded-md px-3 py-1.5 text-sm hover:bg-accent"
            >
              {conv.title}
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 14: Create apps/web-ui/components/layout/layout-wrapper.tsx**

```tsx
'use client';

import { SessionProvider } from 'next-auth/react';
import { AuthGuard } from './auth-guard';
import { Sidebar } from './sidebar';

export function LayoutWrapper({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AuthGuard>
        <div className="flex h-screen">
          <Sidebar />
          <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
        </div>
      </AuthGuard>
    </SessionProvider>
  );
}
```

- [ ] **Step 15: Commit**

```bash
git add apps/web-ui/components/ apps/web-ui/lib/hooks/
git commit -m "feat: add UI components, chat components, and layout shell

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 8: apps/web-ui — API Routes & Pages

**Files:**
- Create: `apps/web-ui/app/api/auth/[...nextauth]/route.ts`
- Create: `apps/web-ui/app/api/health/route.ts`
- Create: `apps/web-ui/app/api/chat/route.ts`
- Create: `apps/web-ui/app/api/conversations/route.ts`
- Create: `apps/web-ui/app/api/conversations/[id]/route.ts`
- Create: `apps/web-ui/app/api/messages/route.ts`
- Create: `apps/web-ui/app/api/tenants/route.ts`
- Create: `apps/web-ui/app/api/invitations/route.ts`
- Create: `apps/web-ui/app/api/audit/route.ts`
- Create: `apps/web-ui/app/(auth)/login/page.tsx`
- Create: `apps/web-ui/app/(auth)/register/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/layout.tsx`
- Create: `apps/web-ui/app/(dashboard)/chat/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/conversations/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/settings/page.tsx`
- Create: `apps/web-ui/lib/auth.ts`

- [ ] **Step 1: Create apps/web-ui/lib/auth.ts**

```typescript
import { createAuthOptions } from '@chatbot/shared';

export const authOptions = createAuthOptions();
```

- [ ] **Step 2: Create apps/web-ui/app/api/auth/[...nextauth]/route.ts**

```typescript
import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```

- [ ] **Step 3: Create apps/web-ui/app/api/health/route.ts**

```typescript
import { NextResponse } from 'next/server';
import { getPrismaClient } from '@chatbot/shared';

export async function GET() {
  const health: Record<string, unknown> = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'web-ui',
    environment: process.env.NODE_ENV || 'development',
  };

  try {
    const prisma = getPrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    health.database = 'connected';
    return NextResponse.json(health, { status: 200 });
  } catch (error) {
    health.status = 'degraded';
    health.database = { status: 'error', error: error instanceof Error ? error.message : 'Unknown' };
    return NextResponse.json(health, { status: 207 });
  }
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
```

- [ ] **Step 4: Create apps/web-ui/app/api/chat/route.ts**

```typescript
import { NextRequest } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, MessageService, ConversationService } from '@chatbot/shared';
import { streamChat } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);

    const authError = await authorize('create', 'Chat', authOptions);
    if (authError) return authError;

    const { conversationId, content, model } = await req.json();

    const conversationService = new ConversationService(tenantId);
    const messageService = new MessageService(tenantId);

    let conversation;
    if (conversationId) {
      conversation = await conversationService.findById(conversationId);
      if (!conversation) {
        return new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404 });
      }
    } else {
      conversation = await conversationService.create({
        userId,
        title: content.slice(0, 100),
        model,
      });
    }

    await messageService.create({
      conversationId: conversation.id,
      role: 'user',
      content,
    });

    const messages = await messageService.findByConversationId(conversation.id);
    const coreMessages = messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    const result = streamChat({
      messages: coreMessages,
      model,
      onFinish: async ({ text, usage }) => {
        await messageService.create({
          conversationId: conversation.id,
          role: 'assistant',
          content: text,
          tokenCount: usage.completionTokens,
        });
        await conversationService.update(conversation.id, {
          messageCount: messages.length + 2,
        });
      },
    });

    return result.toDataStreamResponse({
      headers: { 'x-conversation-id': conversation.id },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    console.error('Chat error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
```

- [ ] **Step 5: Create apps/web-ui/app/api/conversations/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, ConversationService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);

    const authError = await authorize('read', 'Conversations', authOptions);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    const service = new ConversationService(tenantId);
    const result = await service.findByUserId(userId, { limit, offset });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);

    const authError = await authorize('create', 'Conversations', authOptions);
    if (authError) return authError;

    const { title, model } = await req.json();
    const service = new ConversationService(tenantId);
    const conversation = await service.create({ userId, title, model });

    return NextResponse.json(conversation, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 6: Create apps/web-ui/app/api/conversations/[id]/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, ConversationService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Conversations', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const service = new ConversationService(tenantId);
    const conversation = await service.findById(id);

    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(conversation);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Conversations', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const service = new ConversationService(tenantId);
    const conversation = await service.update(id, body);

    return NextResponse.json(conversation);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'Conversations', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const service = new ConversationService(tenantId);
    await service.delete(id);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 7: Create apps/web-ui/app/api/messages/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, MessageService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Chat', authOptions);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get('conversationId');
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
    }

    const limit = parseInt(searchParams.get('limit') ?? '50', 10);
    const service = new MessageService(tenantId);
    const messages = await service.findByConversationId(conversationId, limit);

    return NextResponse.json({ messages });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 8: Create apps/web-ui/app/api/tenants/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getPrismaClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const { name, slug } = await req.json();
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const prisma = getPrismaClient();
    const tenant = await prisma.tenant.create({
      data: { name, slug: slug ?? name.toLowerCase().replace(/\s+/g, '-') },
    });

    await prisma.userTenantRole.create({
      data: {
        userId: session.user.id,
        tenantId: tenant.id,
        email: session.user.email!,
        role: 'Owner',
        assignedBy: session.user.id,
      },
    });

    await prisma.authUser.update({
      where: { id: session.user.id },
      data: { activeTenantId: tenant.id },
    });

    return NextResponse.json(tenant, { status: 201 });
  } catch (error) {
    console.error('Create tenant error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 9: Create apps/web-ui/app/api/invitations/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getTenantClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);

    const authError = await authorize('create', 'Settings', authOptions);
    if (authError) return authError;

    const { email, role } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }

    const db = getTenantClient(tenantId);
    const invitation = await db.invitation.create({
      data: {
        email,
        role: role ?? 'Member',
        invitedBy: userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return NextResponse.json(invitation, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 10: Create apps/web-ui/app/api/audit/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createAuditLogRepository, getTenantClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Conversations', authOptions);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') ?? '50', 10);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);
    const eventType = searchParams.get('eventType') ?? undefined;
    const severity = searchParams.get('severity') ?? undefined;

    const db = getTenantClient(tenantId);
    const repo = createAuditLogRepository(db);
    const result = await repo.findAll({ eventType, severity }, { limit, offset });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 11: Create apps/web-ui/app/(auth)/login/page.tsx**

```tsx
'use client';

import { signIn } from 'next-auth/react';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError('Invalid email or password');
      setLoading(false);
    } else {
      router.push('/chat');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="text-sm text-muted-foreground">Enter your credentials to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
        <Button variant="outline" className="w-full" onClick={() => signIn('cognito', { callbackUrl: '/chat' })}>
          Sign in with SSO
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 12: Create apps/web-ui/app/(auth)/register/page.tsx**

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? 'Registration failed');
      setLoading(false);
    } else {
      router.push('/login');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Create account</h1>
          <p className="text-sm text-muted-foreground">Enter your details to get started</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating...' : 'Create account'}
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account? <Link href="/login" className="underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 13: Create apps/web-ui/app/(dashboard)/layout.tsx**

```tsx
import { LayoutWrapper } from '@/components/layout/layout-wrapper';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <LayoutWrapper>{children}</LayoutWrapper>;
}
```

- [ ] **Step 14: Create apps/web-ui/app/(dashboard)/chat/page.tsx**

```tsx
'use client';

import { useChat } from 'ai/react';
import { useSearchParams } from 'next/navigation';
import { ChatMessages } from '@/components/chat/chat-messages';
import { ChatInput } from '@/components/chat/chat-input';
import { useEffect, useState } from 'react';

export default function ChatPage() {
  const searchParams = useSearchParams();
  const conversationId = searchParams.get('id');
  const [currentConversationId, setCurrentConversationId] = useState(conversationId);

  const { messages, input, handleInputChange, handleSubmit, isLoading, setMessages } = useChat({
    api: '/api/chat',
    body: { conversationId: currentConversationId },
    onResponse: (response) => {
      const newId = response.headers.get('x-conversation-id');
      if (newId && !currentConversationId) {
        setCurrentConversationId(newId);
      }
    },
  });

  useEffect(() => {
    if (conversationId) {
      setCurrentConversationId(conversationId);
      fetch(`/api/messages?conversationId=${conversationId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.messages) {
            setMessages(
              data.messages.map((m: any) => ({
                id: m.id,
                role: m.role,
                content: m.content,
              })),
            );
          }
        });
    }
  }, [conversationId, setMessages]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b px-4 py-3">
        <h2 className="text-lg font-semibold">Chat</h2>
      </div>
      <ChatMessages messages={messages} isLoading={isLoading} />
      <ChatInput
        input={input}
        handleInputChange={handleInputChange}
        handleSubmit={handleSubmit}
        isLoading={isLoading}
      />
    </div>
  );
}
```

- [ ] **Step 15: Create apps/web-ui/app/(dashboard)/conversations/page.tsx**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { MessageSquare, Trash2 } from 'lucide-react';

interface Conversation {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/conversations?limit=50')
      .then((res) => res.json())
      .then((data) => {
        setConversations(data.items ?? []);
        setLoading(false);
      });
  }, []);

  const handleDelete = async (id: string) => {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    setConversations((prev) => prev.filter((c) => c.id !== id));
  };

  if (loading) {
    return <div className="flex items-center justify-center p-8">Loading...</div>;
  }

  return (
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Conversation History</h2>
      {conversations.length === 0 ? (
        <p className="text-muted-foreground">No conversations yet. Start a new chat.</p>
      ) : (
        <div className="space-y-2">
          {conversations.map((conv) => (
            <div key={conv.id} className="flex items-center justify-between rounded-md border p-3">
              <Link href={`/chat?id=${conv.id}`} className="flex items-center gap-3 flex-1">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{conv.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {conv.messageCount} messages &middot; {new Date(conv.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              </Link>
              <Button variant="ghost" size="icon" onClick={() => handleDelete(conv.id)} aria-label="Delete conversation">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 16: Create apps/web-ui/app/(dashboard)/settings/page.tsx**

```tsx
'use client';

import { useSession } from 'next-auth/react';

export default function SettingsPage() {
  const { data: session } = useSession();

  return (
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Settings</h2>
      <div className="space-y-4">
        <div className="rounded-md border p-4">
          <h3 className="text-sm font-medium">Profile</h3>
          <p className="mt-1 text-sm text-muted-foreground">{session?.user?.email}</p>
        </div>
        <div className="rounded-md border p-4">
          <h3 className="text-sm font-medium">Organization</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Tenant ID: {session?.user?.tenantId ?? 'None'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Role: {session?.user?.role ?? 'None'}
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 17: Verify Next.js dev server starts**

Run: `cd /Users/kartik/Documents/git-repo/chatbot/apps/web-ui && bun run dev`
Expected: Next.js starts on port 3001 without compilation errors.

- [ ] **Step 18: Commit**

```bash
git add apps/web-ui/app/ apps/web-ui/lib/auth.ts
git commit -m "feat: add API routes, auth pages, and dashboard pages

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 9: apps/workers — pg-boss Job Processor

**Files:**
- Create: `apps/workers/project.json`
- Create: `apps/workers/package.json`
- Create: `apps/workers/tsconfig.json`
- Create: `apps/workers/vitest.config.ts`
- Create: `apps/workers/.env.example`
- Create: `apps/workers/src/index.ts`
- Create: `apps/workers/src/boss.ts`
- Create: `apps/workers/src/lib/logger.ts`
- Create: `apps/workers/src/executor/types.ts`
- Create: `apps/workers/src/executor/vertical.ts`
- Create: `apps/workers/src/executor/horizontal.ts`
- Create: `apps/workers/src/executor/factory.ts`
- Create: `apps/workers/src/jobs/message-embedding/handler.ts`
- Create: `apps/workers/src/jobs/message-embedding/register.ts`
- Create: `apps/workers/src/jobs/conversation-summary/handler.ts`
- Create: `apps/workers/src/jobs/conversation-summary/register.ts`

- [ ] **Step 1: Create apps/workers/project.json**

```json
{
  "name": "workers",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "apps/workers/src",
  "projectType": "application",
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/apps/workers",
        "tsConfig": "apps/workers/tsconfig.json",
        "main": "apps/workers/src/index.ts"
      }
    },
    "serve": {
      "executor": "nx:run-commands",
      "options": {
        "command": "tsx --env-file=.env --watch src/index.ts",
        "cwd": "apps/workers"
      }
    },
    "test": {
      "executor": "@nx/vite:test",
      "options": {
        "config": "apps/workers/vitest.config.ts"
      }
    }
  }
}
```

- [ ] **Step 2: Create apps/workers/package.json**

```json
{
  "name": "@chatbot/workers",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "tsx --env-file=.env --watch src/index.ts",
    "start": "node --env-file=.env dist/index.js",
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@prisma/client": "^6.0.0",
    "pg-boss": "^10.4.0",
    "ai": "^5.0.0",
    "@ai-sdk/amazon-bedrock": "^2.0.0",
    "dayjs": "^1.11.0",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Create apps/workers/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "sourceMap": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

- [ ] **Step 4: Create apps/workers/vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 5: Create apps/workers/.env.example**

```bash
DATABASE_URL="postgresql://chatbot_admin:chatbot_dev@localhost:5432/chatbot?schema=public"
AWS_REGION=ap-south-1
WORKER_ARCH=vertical
```

- [ ] **Step 6: Create apps/workers/src/lib/logger.ts**

```typescript
export function createLogger(context: string) {
  const prefix = `[${context}]`;
  return {
    info: (msg: string, data?: Record<string, unknown>) =>
      console.log(JSON.stringify({ level: 'info', context, msg, ...data, ts: new Date().toISOString() })),
    warn: (msg: string, data?: Record<string, unknown>) =>
      console.warn(JSON.stringify({ level: 'warn', context, msg, ...data, ts: new Date().toISOString() })),
    error: (msg: string, data?: Record<string, unknown>) =>
      console.error(JSON.stringify({ level: 'error', context, msg, ...data, ts: new Date().toISOString() })),
    debug: (msg: string, data?: Record<string, unknown>) => {
      if (process.env.NODE_ENV !== 'production') {
        console.debug(JSON.stringify({ level: 'debug', context, msg, ...data, ts: new Date().toISOString() }));
      }
    },
  };
}
```

- [ ] **Step 7: Create apps/workers/src/boss.ts**

```typescript
import PgBoss from 'pg-boss';

export function createBoss(): PgBoss {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  return new PgBoss({
    connectionString: DATABASE_URL,
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInHours: 4,
    archiveCompletedAfterSeconds: 86400,
    deleteAfterDays: 7,
    monitorStateIntervalSeconds: 30,
  });
}
```

- [ ] **Step 8: Create apps/workers/src/executor/types.ts**

```typescript
export type HandlerFn = (jobData: unknown) => Promise<unknown>;

export interface JobExecutor {
  execute(jobName: string, jobData: unknown): Promise<unknown>;
  registerHandler?(jobName: string, handler: HandlerFn): void;
}
```

- [ ] **Step 9: Create apps/workers/src/executor/vertical.ts**

```typescript
import { createLogger } from '../lib/logger.js';
import type { HandlerFn, JobExecutor } from './types.js';

const log = createLogger('vertical-executor');

export class VerticalExecutor implements JobExecutor {
  private readonly registry = new Map<string, HandlerFn>();

  registerHandler(jobName: string, handler: HandlerFn): void {
    this.registry.set(jobName, handler);
  }

  async execute(jobName: string, jobData: unknown): Promise<unknown> {
    const handler = this.registry.get(jobName);
    if (!handler) {
      throw new Error(`No handler registered for job: ${jobName}`);
    }
    log.debug('Executing job in-process', { jobName });
    return await handler(jobData);
  }
}
```

- [ ] **Step 10: Create apps/workers/src/executor/horizontal.ts**

```typescript
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { createLogger } from '../lib/logger.js';
import type { JobExecutor } from './types.js';

const log = createLogger('horizontal-executor');

export class HorizontalExecutor implements JobExecutor {
  private readonly ecs = new ECSClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

  async execute(jobName: string, jobData: unknown): Promise<unknown> {
    log.info('Dispatching job to ECS Fargate', { jobName });

    const command = new RunTaskCommand({
      cluster: process.env.ECS_CLUSTER_ARN,
      taskDefinition: process.env.WORKER_TASK_DEFINITION_ARN,
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: (process.env.PRIVATE_SUBNET_IDS ?? '').split(','),
          securityGroups: (process.env.SECURITY_GROUP_IDS ?? '').split(','),
          assignPublicIp: 'DISABLED',
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: 'worker',
            environment: [
              { name: 'JOB_NAME', value: jobName },
              { name: 'JOB_DATA', value: JSON.stringify(jobData) },
            ],
          },
        ],
      },
    });

    const result = await this.ecs.send(command);
    log.info('ECS task dispatched', { taskArn: result.tasks?.[0]?.taskArn });
    return result;
  }
}
```

- [ ] **Step 11: Create apps/workers/src/executor/factory.ts**

```typescript
import { VerticalExecutor } from './vertical.js';
import { HorizontalExecutor } from './horizontal.js';
import type { JobExecutor } from './types.js';

export function createExecutor(arch: string): JobExecutor {
  switch (arch) {
    case 'vertical':
      return new VerticalExecutor();
    case 'horizontal':
      return new HorizontalExecutor();
    default:
      throw new Error(`Unknown WORKER_ARCH: "${arch}". Valid values: vertical, horizontal`);
  }
}
```

- [ ] **Step 12: Create apps/workers/src/jobs/message-embedding/handler.ts**

```typescript
import { getPrismaClient } from '@chatbot/shared';
import { generateEmbedding } from '@chatbot/ai';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('message-embedding');

interface MessageEmbeddingData {
  messageId: string;
}

export async function handleMessageEmbedding(data: unknown): Promise<void> {
  const { messageId } = data as MessageEmbeddingData;
  log.info('Generating embedding', { messageId });

  const prisma = getPrismaClient();
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, content: true },
  });

  if (!message) {
    log.warn('Message not found, skipping', { messageId });
    return;
  }

  const embedding = await generateEmbedding(message.content);
  const vectorStr = `[${embedding.join(',')}]`;

  await prisma.$executeRawUnsafe(
    `UPDATE messages SET embedding = $1::vector WHERE id = $2`,
    vectorStr,
    messageId,
  );

  log.info('Embedding stored', { messageId });
}
```

- [ ] **Step 13: Create apps/workers/src/jobs/message-embedding/register.ts**

```typescript
import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { handleMessageEmbedding } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('message-embedding-register');
const JOB_NAME = 'message-embedding';

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  if (executor.registerHandler) {
    executor.registerHandler(JOB_NAME, handleMessageEmbedding);
  }

  await boss.work(JOB_NAME, { teamSize: 5, teamConcurrency: 2 }, async (job) => {
    log.info('Processing job', { jobId: job.id });
    await executor.execute(JOB_NAME, job.data);
  });

  log.info('Registered job handler', { jobName: JOB_NAME });
}
```

- [ ] **Step 14: Create apps/workers/src/jobs/conversation-summary/handler.ts**

```typescript
import { getPrismaClient } from '@chatbot/shared';
import { streamChat } from '@chatbot/ai';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('conversation-summary');

interface ConversationSummaryData {
  conversationId: string;
  fromMessageIndex: number;
}

export async function handleConversationSummary(data: unknown): Promise<void> {
  const { conversationId, fromMessageIndex } = data as ConversationSummaryData;
  log.info('Generating summary', { conversationId, fromMessageIndex });

  const prisma = getPrismaClient();
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    skip: fromMessageIndex,
    select: { role: true, content: true },
  });

  if (messages.length === 0) {
    log.warn('No messages to summarize', { conversationId });
    return;
  }

  const conversationText = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const result = streamChat({
    messages: [
      {
        role: 'user',
        content: `Summarize this conversation concisely in 2-3 sentences:\n\n${conversationText}`,
      },
    ],
    system: 'You are a helpful assistant that creates concise conversation summaries.',
    maxTokens: 256,
  });

  let summary = '';
  for await (const chunk of result.textStream) {
    summary += chunk;
  }

  await prisma.conversationSummary.create({
    data: {
      conversationId,
      summary,
      messageRange: { from: fromMessageIndex, to: fromMessageIndex + messages.length },
    },
  });

  log.info('Summary stored', { conversationId });
}
```

- [ ] **Step 15: Create apps/workers/src/jobs/conversation-summary/register.ts**

```typescript
import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { handleConversationSummary } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('conversation-summary-register');
const JOB_NAME = 'conversation-summary';

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  if (executor.registerHandler) {
    executor.registerHandler(JOB_NAME, handleConversationSummary);
  }

  await boss.work(JOB_NAME, { teamSize: 2, teamConcurrency: 1 }, async (job) => {
    log.info('Processing job', { jobId: job.id });
    await executor.execute(JOB_NAME, job.data);
  });

  log.info('Registered job handler', { jobName: JOB_NAME });
}
```

- [ ] **Step 16: Create apps/workers/src/index.ts**

```typescript
import { createBoss } from './boss.js';
import { createExecutor } from './executor/factory.js';
import { createLogger } from './lib/logger.js';
import { register as registerMessageEmbedding } from './jobs/message-embedding/register.js';
import { register as registerConversationSummary } from './jobs/conversation-summary/register.js';

const log = createLogger('workers');
const boss = createBoss();
const executor = createExecutor(process.env.WORKER_ARCH ?? 'vertical');

async function main() {
  log.info('Starting pg-boss...');

  boss.on('error', (error) => {
    log.error('pg-boss error', { error: String(error) });
  });

  await boss.start();
  log.info('pg-boss started');

  await registerMessageEmbedding(boss, executor);
  await registerConversationSummary(boss, executor);

  log.info('All jobs registered. Waiting for work...');

  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down...`);
    await boss.stop({ graceful: true, timeout: 30000 });
    log.info('pg-boss stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.error('Fatal error', { error: String(err) });
  process.exit(1);
});
```

- [ ] **Step 17: Install worker dependencies**

Run: `cd /Users/kartik/Documents/git-repo/chatbot/apps/workers && bun install`
Expected: Dependencies install successfully.

- [ ] **Step 18: Commit**

```bash
git add apps/workers/
git commit -m "feat: add workers app with pg-boss, executor pattern, and job handlers

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 10: Docker & Deployment Files

**Files:**
- Create: `apps/web-ui/Dockerfile`
- Create: `apps/web-ui/docker-entrypoint.sh`
- Create: `apps/workers/Dockerfile`

- [ ] **Step 1: Create apps/web-ui/Dockerfile**

```dockerfile
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
```

- [ ] **Step 2: Create apps/web-ui/docker-entrypoint.sh**

```bash
#!/bin/sh
set -e

MAX_RETRIES=10
RETRY_DELAY=3

echo "Waiting for database connectivity..."
retries=0
while [ $retries -lt $MAX_RETRIES ]; do
    if bunx prisma@6 migrate deploy --schema=./prisma/schema.prisma 2>&1; then
        echo "Prisma migrations applied successfully."
        break
    fi

    retries=$((retries + 1))
    if [ $retries -eq $MAX_RETRIES ]; then
        echo "ERROR: Failed to apply migrations after $MAX_RETRIES attempts. Exiting."
        exit 1
    fi

    echo "Database not ready (attempt $retries/$MAX_RETRIES). Retrying in ${RETRY_DELAY}s..."
    sleep $RETRY_DELAY
    RETRY_DELAY=$((RETRY_DELAY * 2))
done

echo "Starting Next.js server..."
exec bun run server.js
```

- [ ] **Step 3: Create apps/workers/Dockerfile**

```dockerfile
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
```

- [ ] **Step 4: Make docker-entrypoint.sh executable**

Run: `chmod +x /Users/kartik/Documents/git-repo/chatbot/apps/web-ui/docker-entrypoint.sh`

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/Dockerfile apps/web-ui/docker-entrypoint.sh apps/workers/Dockerfile
git commit -m "feat: add multi-stage Dockerfiles for web-ui and workers

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 11: Pulumi Infrastructure

**Files:**
- Create: `infra/project.json`
- Create: `infra/package.json`
- Create: `infra/tsconfig.json`
- Create: `infra/Pulumi.yaml`
- Create: `infra/networking/index.ts`
- Create: `infra/compute/index.ts`

- [ ] **Step 1: Create infra/project.json**

```json
{
  "name": "infra",
  "$schema": "../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "infra",
  "projectType": "application",
  "targets": {
    "deploy-networking": {
      "executor": "nx:run-commands",
      "options": {
        "command": "pulumi up --yes --stack prod --cwd networking",
        "cwd": "infra"
      }
    },
    "deploy-compute": {
      "executor": "nx:run-commands",
      "dependsOn": ["deploy-networking"],
      "options": {
        "command": "pulumi up --yes --stack prod --cwd compute",
        "cwd": "infra"
      }
    },
    "preview": {
      "executor": "nx:run-commands",
      "options": {
        "command": "pulumi preview --stack prod --cwd networking && pulumi preview --stack prod --cwd compute",
        "cwd": "infra"
      }
    }
  }
}
```

- [ ] **Step 2: Create infra/package.json**

```json
{
  "name": "@chatbot/infra",
  "version": "0.0.0",
  "private": true,
  "dependencies": {
    "@pulumi/pulumi": "^3.0.0",
    "@pulumi/aws": "^6.0.0",
    "@pulumi/awsx": "^2.0.0",
    "@pulumi/command": "^1.0.0",
    "@pulumi/random": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 3: Create infra/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist"
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create infra/Pulumi.yaml**

```yaml
name: chatbot-infra
runtime:
  name: nodejs
  options:
    typescript: true
description: Chatbot infrastructure (networking + compute)
```

- [ ] **Step 5: Create infra/networking/index.ts**

```typescript
import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';

const config = new pulumi.Config();
const vpcCidrConfig = config.get('vpcCidr') ?? '10.0.0.0/16';
const appName = 'chatbot';

const vpc = new awsx.ec2.Vpc(`${appName}-vpc`, {
  cidrBlock: vpcCidrConfig,
  availabilityZoneNames: ['ap-south-1a', 'ap-south-1b'],
  enableDnsHostnames: true,
  enableDnsSupport: true,
  natGateways: { strategy: 'OnePerAz' },
  subnetSpecs: [
    {
      type: 'Private',
      name: 'private',
      cidrBlocks: ['10.0.0.0/22', '10.0.4.0/22'],
    },
    {
      type: 'Public',
      name: 'public',
      cidrBlocks: ['10.0.8.0/24', '10.0.9.0/24'],
    },
    {
      type: 'Isolated',
      name: 'database',
      cidrBlocks: ['10.0.10.0/24', '10.0.11.0/24'],
    },
    {
      type: 'Isolated',
      name: 'intra',
      cidrBlocks: ['10.0.12.0/26', '10.0.12.64/26'],
    },
  ],
  tags: { Name: `${appName}-vpc` },
});

const databaseSubnetIds: pulumi.Output<string[]> = vpc.subnets
  .apply((subnets) =>
    pulumi.all(
      subnets.map((s) =>
        pulumi.all([s.id, s.tags] as const).apply(([id, tags]) => ({
          id,
          name: (tags ?? {})['Name'] ?? '',
        })),
      ),
    ),
  )
  .apply((items) => items.filter((item) => item.name.includes('-database-')).map((item) => item.id));

const region = aws.config.region ?? 'ap-south-1';

const s3Endpoint = new aws.ec2.VpcEndpoint(`${appName}-endpoint-s3`, {
  vpcId: vpc.vpcId,
  serviceName: pulumi.interpolate`com.amazonaws.${region}.s3`,
  vpcEndpointType: 'Gateway',
  tags: { Name: `${appName}-endpoint-s3` },
});

const dbSubnetGroup = new aws.rds.SubnetGroup(`${appName}-db-subnet-group`, {
  name: `${appName}-db-subnet-group`,
  description: 'Subnet group for RDS databases',
  subnetIds: databaseSubnetIds,
  tags: { Name: `${appName}-db-subnet-group` },
});

export const vpcId = vpc.vpcId;
export const vpcCidr = vpc.vpc.cidrBlock;
export const publicSubnetIds = vpc.publicSubnetIds;
export const privateSubnetIds = vpc.privateSubnetIds;
export { databaseSubnetIds };
export const availabilityZones = pulumi.output(['ap-south-1a', 'ap-south-1b']);
export const dbSubnetGroupName = dbSubnetGroup.name;
```

- [ ] **Step 6: Create infra/compute/index.ts**

```typescript
import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as random from '@pulumi/random';

const callerIdentity = aws.getCallerIdentityOutput({});
const accountId = callerIdentity.accountId;
const region = aws.config.region ?? 'ap-south-1';

const config = new pulumi.Config();
const appUrl = config.get('appUrl') ?? 'https://placeholder.cloudfront.net';
const appName = 'chatbot';

const networking = new pulumi.StackReference(`organization/${appName}-networking/prod`);
const vpcId = networking.requireOutput('vpcId') as pulumi.Output<string>;
const vpcCidr = networking.requireOutput('vpcCidr') as pulumi.Output<string>;
const privateSubnetIds = networking.requireOutput('privateSubnetIds') as pulumi.Output<string[]>;
const publicSubnetIds = networking.requireOutput('publicSubnetIds') as pulumi.Output<string[]>;
const databaseSubnetIds = networking.requireOutput('databaseSubnetIds') as pulumi.Output<string[]>;
const dbSubnetGroupName = networking.requireOutput('dbSubnetGroupName') as pulumi.Output<string>;

// ── Secrets ──
const nextauthSecretRandom = new random.RandomPassword('nextauth-secret-random', {
  length: 32,
  special: false,
  keepers: { version: '1' },
});

const dbPasswordRandom = new random.RandomPassword('db-password-random', {
  length: 24,
  special: false,
  keepers: { version: '1' },
});

const nextauthSecretSm = new aws.secretsmanager.Secret('nextauth-secret', {
  name: `${appName}/nextauth-secret`,
  description: 'NextAuth.js secret for JWT signing',
  recoveryWindowInDays: 0,
});

new aws.secretsmanager.SecretVersion('nextauth-secret-version', {
  secretId: nextauthSecretSm.id,
  secretString: nextauthSecretRandom.result,
});

const databaseUrlSm = new aws.secretsmanager.Secret('database-url', {
  name: `${appName}/database-url`,
  description: 'Full PostgreSQL connection string for ECS tasks',
  recoveryWindowInDays: 0,
});

// ── RDS ──
const dbSecurityGroup = new aws.ec2.SecurityGroup(`${appName}-db-sg`, {
  vpcId,
  description: 'Security group for RDS PostgreSQL',
  ingress: [
    {
      protocol: 'tcp',
      fromPort: 5432,
      toPort: 5432,
      cidrBlocks: [vpcCidr],
    },
  ],
  egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }],
  tags: { Name: `${appName}-db-sg` },
});

const postgresInstance = new aws.rds.Instance(`${appName}-postgres`, {
  identifier: `${appName}-postgres`,
  engine: 'postgres',
  engineVersion: '16.6',
  instanceClass: 'db.t4g.micro',
  allocatedStorage: 20,
  storageType: 'gp3',
  dbName: 'chatbot',
  username: 'chatbot_admin',
  password: dbPasswordRandom.result,
  dbSubnetGroupName,
  vpcSecurityGroupIds: [dbSecurityGroup.id],
  publiclyAccessible: false,
  skipFinalSnapshot: true,
  backupRetentionPeriod: 7,
  tags: { Name: `${appName}-postgres` },
});

new aws.secretsmanager.SecretVersion('database-url-version', {
  secretId: databaseUrlSm.id,
  secretString: pulumi.interpolate`postgresql://chatbot_admin:${dbPasswordRandom.result}@${postgresInstance.address}:5432/chatbot?sslmode=require&sslrootcert=/etc/ssl/certs/rds-combined-ca-bundle.pem`,
});

// ── Cognito ──
const userPool = new aws.cognito.UserPool(`${appName}-user-pool`, {
  name: `${appName}-user-pool`,
  autoVerifiedAttributes: ['email'],
  usernameAttributes: ['email'],
  usernameConfiguration: { caseSensitive: false },
  passwordPolicy: {
    minimumLength: 8,
    requireNumbers: true,
    requireLowercase: true,
    requireSymbols: false,
    requireUppercase: false,
  },
  accountRecoverySetting: {
    recoveryMechanisms: [{ name: 'verified_email', priority: 1 }],
  },
});

const userPoolDomain = new aws.cognito.UserPoolDomain(`${appName}-user-pool-domain`, {
  userPoolId: userPool.id,
  domain: pulumi.interpolate`${appName}-auth-${accountId}`,
});

const userPoolClient = new aws.cognito.UserPoolClient(`${appName}-user-pool-client`, {
  name: `${appName}-app-client`,
  userPoolId: userPool.id,
  generateSecret: true,
  explicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
  allowedOauthFlows: ['code'],
  allowedOauthFlowsUserPoolClient: true,
  allowedOauthScopes: ['openid', 'email', 'profile'],
  callbackUrls: [
    'http://localhost:3001/api/auth/callback/cognito',
    `${appUrl}/api/auth/callback/cognito`,
  ],
  logoutUrls: ['http://localhost:3001', appUrl],
});

// ── S3 ──
const appBucket = new aws.s3.BucketV2(`${appName}-bucket`, {
  bucket: pulumi.interpolate`${appName}-${accountId}-${region}`,
  forceDestroy: false,
});

new aws.s3.BucketLifecycleConfigurationV2(`${appName}-bucket-lifecycle`, {
  bucket: appBucket.id,
  rules: [
    {
      id: 'conversation-exports-expire-7d',
      status: 'Enabled',
      filter: { prefix: 'conversation-exports/' },
      expiration: { days: 7 },
    },
    {
      id: 'temp-expire-1d',
      status: 'Enabled',
      filter: { prefix: 'temp/' },
      expiration: { days: 1 },
    },
  ],
});

// ── ECR ──
const webUiRepo = new aws.ecr.Repository(`${appName}-web-ui`, {
  name: `${appName}/web-ui`,
  imageTagMutability: 'MUTABLE',
  imageScanningConfiguration: { scanOnPush: true },
});

const workersRepo = new aws.ecr.Repository(`${appName}-workers`, {
  name: `${appName}/workers`,
  imageTagMutability: 'MUTABLE',
  imageScanningConfiguration: { scanOnPush: true },
});

// ── ECS Cluster ──
const cluster = new aws.ecs.Cluster(`${appName}-cluster`, {
  name: `${appName}-cluster`,
  settings: [{ name: 'containerInsights', value: 'enabled' }],
});

// ── ALB ──
const albSecurityGroup = new aws.ec2.SecurityGroup(`${appName}-alb-sg`, {
  vpcId,
  description: 'Security group for ALB',
  ingress: [{ protocol: 'tcp', fromPort: 80, toPort: 80, cidrBlocks: ['0.0.0.0/0'] }],
  egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }],
  tags: { Name: `${appName}-alb-sg` },
});

const alb = new aws.lb.LoadBalancer(`${appName}-alb`, {
  name: `${appName}-alb`,
  internal: false,
  loadBalancerType: 'application',
  securityGroups: [albSecurityGroup.id],
  subnets: publicSubnetIds,
  tags: { Name: `${appName}-alb` },
});

const targetGroup = new aws.lb.TargetGroup(`${appName}-web-ui-tg`, {
  name: `${appName}-web-ui-tg`,
  port: 3001,
  protocol: 'HTTP',
  targetType: 'ip',
  vpcId,
  healthCheck: {
    path: '/api/health',
    interval: 30,
    timeout: 5,
    healthyThreshold: 2,
    unhealthyThreshold: 3,
  },
});

new aws.lb.Listener(`${appName}-alb-listener`, {
  loadBalancerArn: alb.arn,
  port: 80,
  protocol: 'HTTP',
  defaultActions: [{ type: 'forward', targetGroupArn: targetGroup.arn }],
});

// ── IAM Roles ──
const taskExecutionRole = new aws.iam.Role(`${appName}-task-execution-role`, {
  name: `${appName}-task-execution-role`,
  assumeRolePolicy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Service: 'ecs-tasks.amazonaws.com' },
        Action: 'sts:AssumeRole',
      },
    ],
  }),
  managedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'],
});

new aws.iam.RolePolicy(`${appName}-task-execution-secrets`, {
  role: taskExecutionRole.id,
  policy: pulumi.all([nextauthSecretSm.arn, databaseUrlSm.arn]).apply(([nsArn, dbArn]) =>
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['secretsmanager:GetSecretValue'],
          Resource: [nsArn, dbArn],
        },
      ],
    }),
  ),
});

const taskRole = new aws.iam.Role(`${appName}-task-role`, {
  name: `${appName}-task-role`,
  assumeRolePolicy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Service: 'ecs-tasks.amazonaws.com' },
        Action: 'sts:AssumeRole',
      },
    ],
  }),
});

new aws.iam.RolePolicy(`${appName}-task-policy`, {
  role: taskRole.id,
  policy: appBucket.arn.apply((bucketArn) =>
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
          Resource: [bucketArn, `${bucketArn}/*`],
        },
        {
          Effect: 'Allow',
          Action: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          Resource: ['*'],
        },
      ],
    }),
  ),
});

// ── CloudWatch Log Groups ──
const webUiLogGroup = new aws.cloudwatch.LogGroup(`${appName}-web-ui-logs`, {
  name: `/ecs/${appName}/web-ui`,
  retentionInDays: 7,
});

const workersLogGroup = new aws.cloudwatch.LogGroup(`${appName}-workers-logs`, {
  name: `/ecs/${appName}/workers`,
  retentionInDays: 7,
});

// ── ECS Task Definitions ──
const ecsSecurityGroup = new aws.ec2.SecurityGroup(`${appName}-ecs-sg`, {
  vpcId,
  description: 'Security group for ECS tasks',
  ingress: [{ protocol: 'tcp', fromPort: 3001, toPort: 3001, securityGroups: [albSecurityGroup.id] }],
  egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }],
  tags: { Name: `${appName}-ecs-sg` },
});

const webUiTaskDef = new aws.ecs.TaskDefinition(`${appName}-web-ui-task`, {
  family: `${appName}-web-ui`,
  networkMode: 'awsvpc',
  requiresCompatibilities: ['FARGATE'],
  cpu: '256',
  memory: '512',
  executionRoleArn: taskExecutionRole.arn,
  taskRoleArn: taskRole.arn,
  runtimePlatform: { cpuArchitecture: 'ARM64', operatingSystemFamily: 'LINUX' },
  containerDefinitions: pulumi
    .all([webUiRepo.repositoryUrl, nextauthSecretSm.arn, databaseUrlSm.arn, webUiLogGroup.name])
    .apply(([repoUrl, nsArn, dbArn, logGroup]) =>
      JSON.stringify([
        {
          name: 'web-ui',
          image: `${repoUrl}:latest`,
          essential: true,
          portMappings: [{ containerPort: 3001, protocol: 'tcp' }],
          secrets: [
            { name: 'NEXTAUTH_SECRET', valueFrom: nsArn },
            { name: 'DATABASE_URL', valueFrom: dbArn },
          ],
          environment: [
            { name: 'NEXTAUTH_URL', value: appUrl },
            { name: 'AWS_REGION', value: region },
          ],
          logConfiguration: {
            logDriver: 'awslogs',
            options: { 'awslogs-group': logGroup, 'awslogs-region': region, 'awslogs-stream-prefix': 'ecs' },
          },
        },
      ]),
    ),
});

const workersTaskDef = new aws.ecs.TaskDefinition(`${appName}-workers-task`, {
  family: `${appName}-workers`,
  networkMode: 'awsvpc',
  requiresCompatibilities: ['FARGATE'],
  cpu: '256',
  memory: '512',
  executionRoleArn: taskExecutionRole.arn,
  taskRoleArn: taskRole.arn,
  runtimePlatform: { cpuArchitecture: 'ARM64', operatingSystemFamily: 'LINUX' },
  containerDefinitions: pulumi
    .all([workersRepo.repositoryUrl, databaseUrlSm.arn, workersLogGroup.name])
    .apply(([repoUrl, dbArn, logGroup]) =>
      JSON.stringify([
        {
          name: 'worker',
          image: `${repoUrl}:latest`,
          essential: true,
          secrets: [{ name: 'DATABASE_URL', valueFrom: dbArn }],
          environment: [
            { name: 'AWS_REGION', value: region },
            { name: 'WORKER_ARCH', value: 'vertical' },
          ],
          logConfiguration: {
            logDriver: 'awslogs',
            options: { 'awslogs-group': logGroup, 'awslogs-region': region, 'awslogs-stream-prefix': 'ecs' },
          },
        },
      ]),
    ),
});

// ── ECS Services ──
const webUiService = new aws.ecs.Service(`${appName}-web-ui-service`, {
  name: `${appName}-web-ui`,
  cluster: cluster.arn,
  taskDefinition: webUiTaskDef.arn,
  desiredCount: 1,
  launchType: 'FARGATE',
  networkConfiguration: {
    subnets: privateSubnetIds,
    securityGroups: [ecsSecurityGroup.id],
    assignPublicIp: false,
  },
  loadBalancers: [
    {
      targetGroupArn: targetGroup.arn,
      containerName: 'web-ui',
      containerPort: 3001,
    },
  ],
});

const workersService = new aws.ecs.Service(`${appName}-workers-service`, {
  name: `${appName}-workers`,
  cluster: cluster.arn,
  taskDefinition: workersTaskDef.arn,
  desiredCount: 1,
  launchType: 'FARGATE',
  networkConfiguration: {
    subnets: privateSubnetIds,
    securityGroups: [ecsSecurityGroup.id],
    assignPublicIp: false,
  },
});

// ── Auto Scaling ──
const webUiScalingTarget = new aws.appautoscaling.Target(`${appName}-web-ui-scaling-target`, {
  maxCapacity: 4,
  minCapacity: 1,
  resourceId: pulumi.interpolate`service/${cluster.name}/${webUiService.name}`,
  scalableDimension: 'ecs:service:DesiredCount',
  serviceNamespace: 'ecs',
});

new aws.appautoscaling.Policy(`${appName}-web-ui-cpu-scaling`, {
  name: `${appName}-web-ui-cpu-scaling`,
  policyType: 'TargetTrackingScaling',
  resourceId: webUiScalingTarget.resourceId,
  scalableDimension: webUiScalingTarget.scalableDimension,
  serviceNamespace: webUiScalingTarget.serviceNamespace,
  targetTrackingScalingPolicyConfiguration: {
    predefinedMetricSpecification: { predefinedMetricType: 'ECSServiceAverageCPUUtilization' },
    targetValue: 70,
  },
});

// ── Exports ──
export const rdsEndpoint = postgresInstance.address;
export const albDnsName = alb.dnsName;
export const ecsClusterName = cluster.name;
export const webUiRepoUrl = webUiRepo.repositoryUrl;
export const workersRepoUrl = workersRepo.repositoryUrl;
export const cognitoUserPoolId = userPool.id;
export const cognitoClientId = userPoolClient.id;
export const s3BucketName = appBucket.bucket;
```

- [ ] **Step 7: Install infra dependencies**

Run: `cd /Users/kartik/Documents/git-repo/chatbot/infra && bun install`
Expected: Dependencies install successfully.

- [ ] **Step 8: Commit**

```bash
git add infra/
git commit -m "feat: add Pulumi infrastructure stacks (networking + compute)

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 12: Final Verification & Cleanup

**Files:**
- Modify: `libs/shared/src/index.ts` (ensure all exports are correct)
- Modify: `package.json` (ensure workspaces config)

- [ ] **Step 1: Add Nx workspace configuration to root package.json**

Add workspaces field to root `package.json`:

```json
{
  "workspaces": [
    "apps/*",
    "libs/*",
    "infra"
  ]
}
```

- [ ] **Step 2: Verify Nx project graph**

Run: `npx nx graph --file=output.json`
Expected: Graph generates showing web-ui, workers, shared, ai, infra projects with correct dependency edges (web-ui → shared, web-ui → ai, workers → shared, workers → ai).

- [ ] **Step 3: Start PostgreSQL and run migrations**

Run: `cd /Users/kartik/Documents/git-repo/chatbot && docker compose up -d && sleep 3 && bunx prisma migrate dev --name init --schema=./prisma/schema.prisma`
Expected: PostgreSQL starts, migration applies successfully.

- [ ] **Step 4: Generate Prisma client**

Run: `cd /Users/kartik/Documents/git-repo/chatbot && bunx prisma generate --schema=./prisma/schema.prisma`
Expected: Prisma client generated successfully.

- [ ] **Step 5: Verify web-ui builds**

Run: `cd /Users/kartik/Documents/git-repo/chatbot/apps/web-ui && bun run build`
Expected: Next.js build completes without errors.

- [ ] **Step 6: Verify workers build**

Run: `cd /Users/kartik/Documents/git-repo/chatbot/apps/workers && bun run build`
Expected: TypeScript compilation completes without errors.

- [ ] **Step 7: Start web-ui dev server and verify health endpoint**

Run: `cd /Users/kartik/Documents/git-repo/chatbot/apps/web-ui && bun run dev &`
Wait 5 seconds, then:
Run: `curl -s http://localhost:3001/api/health | jq .`
Expected: `{"status":"healthy","timestamp":"...","service":"web-ui","environment":"development","database":"connected"}`

- [ ] **Step 8: Verify chat page loads in browser**

Open `http://localhost:3001/chat` in browser.
Expected: Redirects to `/login` (no session). Login page renders with email/password form and SSO button.

- [ ] **Step 9: Stop dev server and clean up**

Stop the dev server process. Remove any temporary files.

- [ ] **Step 10: Final commit**

```bash
git add -A
git commit -m "feat: finalize chatbot starter template with verification

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Summary

This plan creates a complete, production-ready chatbot starter template as an Nx monorepo with 12 tasks:

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Nx workspace scaffolding | package.json, nx.json, tsconfig.base.json, docker-compose.yml |
| 2 | Prisma schema & DB setup | prisma/schema.prisma |
| 3 | libs/shared — database layer | prisma-client, tenant-middleware, repositories |
| 4 | libs/shared — auth, RBAC, services | auth-options, authorize, permissions, services |
| 5 | libs/ai — Bedrock integration | bedrock-client, chat-completion, embeddings |
| 6 | apps/web-ui — Next.js scaffolding | project.json, next.config, tailwind, middleware |
| 7 | apps/web-ui — UI components | button, input, dialog, chat components, sidebar |
| 8 | apps/web-ui — API routes & pages | chat, conversations, messages, auth, dashboard |
| 9 | apps/workers — pg-boss processor | boss, executor, message-embedding, conversation-summary |
| 10 | Docker & deployment files | Dockerfiles, docker-entrypoint.sh |
| 11 | Pulumi infrastructure | networking (VPC), compute (RDS, ECS, Cognito, ALB) |
| 12 | Final verification & cleanup | Build verification, health check, browser test |
