# Chatbot Platform — Docs, Marketing & Testing Integration

**Date:** 2026-05-02
**Status:** Draft
**Reference:** nucleus-cloud-ops (master-v1 branch)

## Overview

Integrate three major capabilities into the chatbot monorepo by adapting patterns from the nucleus-cloud-ops reference repository:

1. **Marketing landing page** — public homepage for the open-source AI chatbot platform
2. **Fumadocs documentation site** — MDX-powered docs with search and OpenAPI reference
3. **End-to-end tests** — Playwright test suite covering marketing, docs, navigation, and auth flows
4. **Unit tests** — Vitest tests for libs/shared and libs/ai

Architecture decision: all integrated into `apps/web-ui` (Approach A) using Next.js route groups, matching the reference repo pattern.

## 1. Marketing Landing Page

**Position:** Free, self-hosted, open-source AI chatbot platform (MIT license).

**Theme:** Light/clean — white background, bordered cards, modern SaaS aesthetic.

**Route:** `/` replaces the current redirect-to-`/chat` page.

**Page structure:**

| Section | Content |
|---------|---------|
| Nav bar | Brand "Chatbot", links: Features, GitHub, Docs, Sign in, Get Started |
| Hero | Open Source badge, headline, subtitle, Deploy Free + View on GitHub CTAs |
| Stats bar | 100% Free, Multi-Tenant, RBAC Built-in, MIT License |
| Screenshot | Chat UI mockup/screenshot |
| Features (2-col grid) | Multi-Tenant, AWS Bedrock, RAG Pipeline (pgvector), RBAC & Security, Audit Logs, Background Jobs (pg-boss), Cognito Auth, Conversation History |
| Pricing | Self-Hosted ($0/forever), Cloud Hosted (coming soon), Enterprise (custom) |
| CTA banner | "Ready to deploy?" with Get Started link |
| Footer | Brand, Docs link, Getting Started link, GitHub, MIT License |

**Implementation notes:**
- Server component, no client-side JS needed
- Uses existing Tailwind + Radix UI design tokens
- Lucide icons for feature cards
- Links: Get Started → `/login`, Docs → `/docs`, GitHub → repo URL

## 2. Fumadocs Documentation Site

**Dependencies to add to `apps/web-ui`:**
- `fumadocs-core` — core loader, search, source utilities
- `fumadocs-mdx` — MDX compilation, source config
- `fumadocs-ui` — pre-built UI components (DocsPage, DocsLayout, RootProvider)
- `fumadocs-openapi` — OpenAPI spec rendering in docs

**Configuration files:**

### source.config.ts (project root of web-ui)
```ts
import { defineDocs, defineConfig } from "fumadocs-mdx/config";

export const { docs, meta } = defineDocs({
  dir: "content/docs",
});

export default defineConfig();
```

### lib/docs-source.ts
```ts
import { loader } from "fumadocs-core/source";
import { createMDXSource } from "fumadocs-mdx";
import { docs, meta } from "@/.source";

export const source = loader({
  baseUrl: "/docs",
  source: createMDXSource(docs, meta),
});
```

### next.config.ts modification
Wrap existing config with `createMDX()` from `fumadocs-mdx/next`:
```ts
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@chatbot/shared', '@chatbot/ai'],
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
};

export default withMDX(nextConfig);
```

### Route structure

```
app/(docs)/
├── layout.tsx                    # RootProvider with theme CSS vars
└── docs/[[...slug]]/
    ├── layout.tsx                # DocsLayout with sidebar tree, nav branding
    └── page.tsx                  # Dynamic page: DocsPage + DocsBody + DocsTitle
```

### Content (7 pages)

```
content/docs/
├── meta.json                     # Navigation order
├── index.mdx                     # Overview, feature table, quick links
├── getting-started.mdx           # 5-minute setup guide
├── installation.mdx              # Docker, Pulumi, manual deployment
├── configuration.mdx             # Env vars, Bedrock, Cognito, pgvector setup
├── api-reference.mdx             # OpenAPI-rendered REST API docs
├── architecture.mdx              # System design, monorepo structure, data flow
└── faq.mdx                       # Common questions
```

**meta.json:**
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

### Search

Built-in static search via `fumadocs-core`:
- Search index generated at build time from MDX content
- Search dialog component in docs layout header
- Cmd+K keyboard shortcut

### OpenAPI Integration

- `fumadocs-openapi` renders interactive API reference from an OpenAPI spec
- OpenAPI spec file at `content/docs/openapi.json` documenting existing routes:
  - `POST /api/chat` — streaming chat completion
  - `GET/POST /api/conversations` — conversation CRUD
  - `GET /api/conversations/[id]` — single conversation
  - `GET/POST /api/messages` — message history
  - `GET /api/health` — health check
  - `GET/POST /api/tenants` — tenant management
  - `GET /api/audit` — audit log queries
  - `POST /api/invitations` — team invitations
  - `GET/POST /api/auth/[...nextauth]` — NextAuth endpoints

## 3. Playwright E2E Tests

**Root config:** `playwright.config.ts`

```ts
{
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
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'tests/e2e/.auth/session.json' },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  webServer: {
    command: 'cd apps/web-ui && bun run dev',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
  },
}
```

**Key differences from reference:**
- `baseURL` is `localhost:3001` (chatbot's dev port)
- `webServer.command` uses `bun run dev` and `cd apps/web-ui`
- Auth setup mints NextAuth JWT using the chatbot's secret and session shape

### Test files

**auth.setup.ts** — Mint a NextAuth session cookie with test user credentials (name, email, sub, groups). Uses `next-auth/jwt` encode. Saves storage state to `.auth/session.json`.

**marketing.spec.ts** (~80 lines) — No auth needed. Tests:
- Nav bar: brand, links (Features, GitHub, Docs, Sign in, Get Started)
- Hero: headline, subtitle, open-source badge, CTA buttons
- Features section: all 8 feature cards visible
- Pricing: three tiers visible, Self-Hosted shows $0
- CTA banner: headline, link navigates to /login
- Footer: brand, docs link, MIT license text

**docs.spec.ts** (~100 lines) — No auth needed. Tests:
- Each docs page loads without 404 (/docs, /docs/getting-started, etc.)
- Headings visible on each page
- Sidebar navigation rendered
- All sidebar links load without 404

**navigation.spec.ts** (~60 lines) — Auth required. Tests:
- /chat page loads with chat interface
- /conversations page loads
- /settings page loads
- Unauthenticated users redirected to /login

**auth.spec.ts** (~40 lines) — No auth. Tests:
- Login page renders sign-in form
- Register page renders registration form
- Authenticated users redirected away from login

### Nx integration

Add `e2e` target to `nx.json`:
```json
{
  "e2e": {
    "cache": true,
    "inputs": ["default", "^production"]
  }
}
```

Add to root `package.json`:
```json
{
  "scripts": {
    "e2e": "playwright test",
    "e2e:ui": "playwright test --ui"
  }
}
```

### Dependencies (root)

- `@playwright/test`

## 4. Vitest Unit Tests

### libs/shared tests

All tests mock Prisma client and external dependencies. Focus on business logic.

| Test file | What it covers |
|-----------|---------------|
| `db/repositories/conversation/postgres.test.ts` | CRUD operations, tenant filtering, pagination |
| `db/repositories/message/postgres.test.ts` | Create, list by conversation, role filtering |
| `db/repositories/audit-log/postgres.test.ts` | Create, query with filters, severity levels |
| `db/tenant-middleware.test.ts` | Tenant ID injection, model scoping, TENANT_SCOPED_MODELS |
| `auth/auth-session.test.ts` | getSessionTenantId, getSessionUserId, assertSuperAdmin |
| `rbac/permissions.test.ts` | hasPermission, hasCustomPermission, ROLE_PERMISSIONS mapping |
| `rbac/authorize.test.ts` | authorize middleware — allowed/denied scenarios per role |
| `services/audit-service.test.ts` | AuditService.log, AuditService.query |
| `services/conversation-service.test.ts` | create, list, update, delete conversations |
| `services/message-service.test.ts` | create, listByConversation |
| `services/tenant-config-service.test.ts` | get/update tenant config |

### libs/ai tests

Mock AWS Bedrock SDK and AI SDK internals.

| Test file | What it covers |
|-----------|---------------|
| `bedrock-client.test.ts` | getBedrockProvider returns configured provider, DEFAULT_MODEL value |
| `chat-completion.test.ts` | streamChat options validation, model selection, message formatting |
| `embeddings.test.ts` | generateEmbedding returns vector, generateEmbeddings batching |

### Coverage thresholds

Added to each workspace's `vitest.config.ts`:
```ts
{
  test: {
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 60,
        branches: 60,
        functions: 60,
      },
    },
  },
}
```

Starting at 60% — ratchet up as test coverage grows.

## 5. File Changes Summary

### New files
- `apps/web-ui/source.config.ts`
- `apps/web-ui/lib/docs-source.ts`
- `apps/web-ui/content/docs/meta.json`
- `apps/web-ui/content/docs/index.mdx`
- `apps/web-ui/content/docs/getting-started.mdx`
- `apps/web-ui/content/docs/installation.mdx`
- `apps/web-ui/content/docs/configuration.mdx`
- `apps/web-ui/content/docs/api-reference.mdx`
- `apps/web-ui/content/docs/architecture.mdx`
- `apps/web-ui/content/docs/faq.mdx`
- `apps/web-ui/content/docs/openapi.json`
- `apps/web-ui/app/(docs)/layout.tsx`
- `apps/web-ui/app/(docs)/docs/[[...slug]]/layout.tsx`
- `apps/web-ui/app/(docs)/docs/[[...slug]]/page.tsx`
- `playwright.config.ts`
- `tests/e2e/auth.setup.ts`
- `tests/e2e/marketing.spec.ts`
- `tests/e2e/docs.spec.ts`
- `tests/e2e/navigation.spec.ts`
- `tests/e2e/auth.spec.ts`
- `libs/shared/src/db/repositories/conversation/postgres.test.ts`
- `libs/shared/src/db/repositories/message/postgres.test.ts`
- `libs/shared/src/db/repositories/audit-log/postgres.test.ts`
- `libs/shared/src/db/tenant-middleware.test.ts`
- `libs/shared/src/auth/auth-session.test.ts`
- `libs/shared/src/rbac/permissions.test.ts`
- `libs/shared/src/rbac/authorize.test.ts`
- `libs/shared/src/services/audit-service.test.ts`
- `libs/shared/src/services/conversation-service.test.ts`
- `libs/shared/src/services/message-service.test.ts`
- `libs/shared/src/services/tenant-config-service.test.ts`
- `libs/ai/src/bedrock-client.test.ts`
- `libs/ai/src/chat-completion.test.ts`
- `libs/ai/src/embeddings.test.ts`

### Modified files
- `apps/web-ui/next.config.ts` — wrap with createMDX()
- `apps/web-ui/app/page.tsx` — replace redirect with marketing landing page
- `apps/web-ui/package.json` — add fumadocs deps
- `package.json` — add playwright, e2e scripts
- `nx.json` — add e2e target
- `libs/shared/vitest.config.ts` — add coverage thresholds
- `libs/ai/vitest.config.ts` — add coverage thresholds
- `.gitignore` — add tests/e2e/.auth/, .superpowers/

## 6. Out of Scope

- CI pipeline (GitHub Actions) — not selected
- Storybook / visual testing — premature for current component count
- Versioned documentation — premature until breaking API changes
- Workers unit tests — deferred, libs first
- Database integration tests — unit tests use mocks only
