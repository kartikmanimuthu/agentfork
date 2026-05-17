# Chatbot

Multi-tenant AI chatbot. Bun + Nx monorepo, Next.js frontend, TypeScript workers, Prisma + pgvector on PostgreSQL.

## Commands

```bash
bun run setup                        # Copy .env.example, generate Prisma client, run migrations
bun install                          # Install deps + generate Prisma client (prepare script)
bun run dev                          # Next.js dev server (web-ui)
bun run dev:workers                  # Workers dev server
bun run dev:all                      # Both in parallel
bun run build                        # Build all projects
bun run test                         # Unit tests (shared, ai, workers via Vitest)
bun run e2e                          # Playwright e2e (headless)
bun run e2e:ui                       # Playwright e2e (interactive UI)
nx test workers                      # Test single project
nx test shared
nx test ai
nx affected -t test                  # Test only affected projects
nx graph                             # Visualize dependency graph
```

### Prisma

```bash
bunx prisma generate --schema=./prisma/schema.prisma   # Regenerate client after schema changes
bunx prisma db push                                     # Push schema to local DB (no migration)
bunx prisma migrate dev                                 # Create + apply migration
```

## Project Structure

```
apps/
  web-ui/            Next.js 15 (App Router) — chat UI, auth, docs (Fumadocs)
    app/
      (auth)/        Login, register
      (dashboard)/   Chat, conversations, settings
      (docs)/        Documentation pages (MDX via Fumadocs)
      api/           API routes
  workers/           Background job processor
    src/
      boss.ts        Job orchestrator
      executor/      Execution strategies (vertical.ts, horizontal.ts, factory.ts)
      jobs/          Job definitions (conversation-summary, message-embedding)
libs/
  ai/                AI SDK wrappers — Bedrock client, chat completion, embeddings
  shared/            Auth, DB (Prisma), RBAC (authorize, permissions), services, types
    src/services/    audit, conversation, message, tenant-config services
    src/rbac/        Role-based access control
infra/               Pulumi IaC (TypeScript) — AWS networking + compute
prisma/              Schema + migrations (PostgreSQL 16 with pgvector)
```

### Path Aliases

- `@chatbot/shared` → `libs/shared/src/index.ts`
- `@chatbot/shared/client` → `libs/shared/src/client.ts`
- `@chatbot/ai` → `libs/ai/src/index.ts`

## Local Setup

1. `docker compose up -d` — PostgreSQL 16 with pgvector (port 5432, user: chatbot_admin, db: chatbot)
2. `cp .env.example .env` — root env vars
3. `bun install` — deps + Prisma client generation
4. `bunx prisma db push` — apply schema to local DB

Or run `bun run setup` to do steps 2–4 in one command.

### Required Environment Variables

- `DATABASE_URL` — PostgreSQL connection string
- `NEXTAUTH_SECRET` — session signing key (generate with `openssl rand -base64 32`)
- `NEXTAUTH_URL` — app base URL (default: http://localhost:3001)
- `AWS_REGION` — AWS region (default: ap-south-1)

### Optional Environment Variables

- **Cognito SSO**: `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, `COGNITO_APP_CLIENT_SECRET`, `COGNITO_ISSUER` — enable SSO login alongside credentials auth.
- **Bedrock models**: `BEDROCK_CHAT_MODEL`, `BEDROCK_EMBEDDING_MODEL` — override default AI models.
- **Workers**: `WORKER_ARCH` — `vertical` (default, single process) or `horizontal` (multi-process via ECS).

## Architecture Notes

- **Auth**: NextAuth v4 with credentials provider + middleware. Tenant ID injected via `x-tenant-id` header in middleware.
- **Multi-tenancy**: Tenant-scoped via middleware header injection. Users without a tenant are redirected to `/create-org`.
- **AI**: Vercel AI SDK with Amazon Bedrock provider. Embeddings use pgvector.
- **Workers**: Boss/executor pattern. Factory selects vertical or horizontal execution strategy. Jobs: conversation summarization, message embedding.
- **Docs**: Fumadocs v14 with MDX, integrated into the Next.js app under `(docs)` route group.
- **Next.js**: Standalone output mode, transpiles `@chatbot/shared` and `@chatbot/ai`.

## Gotchas

- Nx targets use `nx:run-commands` executor, NOT `@nx/next:build` or `@nx/next:server`. The `@nx/next` executors break when `next` is in root devDependencies.
- `libs/ai/src/` and `libs/shared/src/` contain compiled `.js`/`.d.ts` alongside `.ts` sources — these are build output, don't delete them.
- Prisma client must be regenerated after schema changes (`bunx prisma generate`).
- E2e tests depend on `web-ui:build` (configured in `nx.json` targetDefaults).
- `serverExternalPackages` in `next.config.ts` excludes `@prisma/client`, `bcryptjs`, `pino`, and `thread-stream` from bundling.
- Fumadocs v14 is pinned for Tailwind v3 compatibility. Import its CSS in `layout.tsx`, not `globals.css`.

## Testing

- **Unit**: Vitest — config per project (`vitest.config.ts`), run with `bunx vitest run`
- **E2e**: Playwright — config at root (`playwright.config.ts`), auth state stored in `tests/e2e/.auth/`
- **Coverage**: `@vitest/coverage-v8`, output to `coverage/`

## Code Style

- TypeScript strict mode, ES2022 target, ESNext modules
- Prettier for formatting, ESLint with `@nx/eslint-plugin`
- Prisma models use `@@map()` for snake_case table names, camelCase fields
- Services in `libs/shared` follow a class-based pattern with Prisma client injection

## Mandatory Standards

### Validation
- All frontend form inputs must be validated with Zod schemas before submission
- All API route handlers must validate request bodies/params with Zod at the boundary
- All TypeScript functions must have typed parameters — no implicit `any`, no untyped args

### Environment Variables
- All env vars must be declared and validated via T3 Env (`@t3-oss/env-nextjs` for web-ui, `@t3-oss/env-core` for workers/libs)
- Never access `process.env` directly — always go through the typed env object

### UI Components
- All frontend UI must use shadcn/ui components exclusively — no raw HTML form elements or ad-hoc component libraries

### Error Handling
- Every function, route handler, and job executor must wrap logic in try/catch
- Catch blocks must log the error (never swallow silently) and re-throw or return a typed error response

### Logging (Pino)
- Use Pino logger in every function, route handler, and worker executor
- Log at the correct severity: `logger.info` for normal flow, `logger.warn` for recoverable issues, `logger.error` for caught exceptions, `logger.debug` for dev-only detail
- Include structured context in log calls (e.g. `{ tenantId, userId, jobId }`) — no bare string-only logs
- Pino is already in `serverExternalPackages` — import from the shared logger instance, don't create ad-hoc loggers
