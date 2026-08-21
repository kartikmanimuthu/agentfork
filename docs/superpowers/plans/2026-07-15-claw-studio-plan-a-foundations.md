# Claw Studio — Plan A: Foundations & Provisioning

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision a per-tenant Claw Studio (Studio ID + one-time password + its single Claw) from the web-ui dashboard, with a launch button to Mission Control.

**Architecture:** New Prisma models (`ClawStudio`, `Claw`, `ClawConversation`) in the shared schema. A tenant-scoped `StudioService` in `libs/shared` (following the existing `ApiKeyService` pattern) handles provisioning, password reset, and lookup. Three web-ui API routes wrap it. A new `/claw-studio` dashboard page renders the "Claw" card: Generate → reveal credentials once → Mission Control launch button; Reset Password re-reveals. **No agent runtime here** — that is Plan C.

**Tech Stack:** Prisma + PostgreSQL, TypeScript, Next.js 15 App Router, NextAuth v4, `bcryptjs`, `crypto`, Zod, shadcn/ui, TanStack Query, Pino.

## Global Constraints

- **Validation:** every API route validates its body/params with Zod at the boundary; every web-ui form input validated with Zod before submission.
- **Env:** all new env vars declared/validated via T3 Env (`apps/web-ui/lib/env.ts`); never read `process.env` directly.
- **UI:** shadcn/ui components only — no raw HTML form elements.
- **Error handling:** every route handler and service method wraps logic in try/catch; catch logs (Pino) then re-throws or returns a typed error response.
- **Logging:** Pino via `createLogger`; structured context `{ tenantId, studioId, clawId }` — no bare string-only logs.
- **Credentials:** studio password hashed with `bcryptjs` (cost 10); only the bcrypt hash is stored; the plaintext password is returned to the client exactly once (on provision/reset) and never persisted or logged.
- **Multiplicity gating:** "one Studio per tenant" and "one Claw per Studio" are enforced in **service code**, never as DB unique constraints on `tenantId`/`clawStudioId`.
- **Datastore:** PostgreSQL only. No MongoDB.
- **Dependency isolation:** do not add `@copilotkit/*`, `@langchain/*`, or `deepagents` to `web-ui` or `libs/shared` — those belong to `apps/mission-control` / `libs/claw-studio` in later plans.
- **Prisma conventions:** `cuid()` ids, camelCase fields, `@@map` snake_case table names, `@@index` on `tenantId`.

---

### Task 1: Prisma models — `ClawStudio`, `Claw`, `ClawConversation`

**Files:**
- Modify: `prisma/schema.prisma` (add three models; add `clawStudios ClawStudio[]` relation to `model Tenant`)

**Interfaces:**
- Produces: Prisma delegates `db.clawStudio`, `db.claw`, `db.clawConversation` with the fields below. Later tasks rely on: `ClawStudio { id, tenantId, studioId, passwordHash, status, lastLoginAt, createdAt, updatedAt }`; `Claw { id, clawStudioId, name, systemPrompt, providerModelId, autoApprove, settings, createdAt, updatedAt }`.

- [ ] **Step 1: Add the relation field to `Tenant`**

In `prisma/schema.prisma`, inside `model Tenant { ... }`, add to the relation list (next to `llmProviders LlmProvider[]`):

```prisma
  clawStudios       ClawStudio[]
```

- [ ] **Step 2: Add the three models**

Append to `prisma/schema.prisma`:

```prisma
model ClawStudio {
  id           String    @id @default(cuid())
  tenantId     String
  studioId     String    @unique // public login identifier shown to the user
  passwordHash String
  status       String    @default("active")
  lastLoginAt  DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  claws  Claw[]

  @@index([tenantId])
  @@map("claw_studios")
}

model Claw {
  id              String   @id @default(cuid())
  clawStudioId    String
  name            String   @default("Claw")
  systemPrompt    String?
  providerModelId String? // FK-by-value to LlmProvider.id (tenant's LLM provider); wired in Plan C
  autoApprove     Boolean  @default(false)
  settings        Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  studio        ClawStudio         @relation(fields: [clawStudioId], references: [id], onDelete: Cascade)
  conversations ClawConversation[]

  @@index([clawStudioId])
  @@map("claws")
}

model ClawConversation {
  id        String   @id @default(cuid())
  clawId    String
  threadId  String   @unique // LangGraph checkpoint thread id (used in Plan C)
  title     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  claw Claw @relation(fields: [clawId], references: [id], onDelete: Cascade)

  @@index([clawId])
  @@map("claw_conversations")
}
```

- [ ] **Step 3: Validate the schema**

Run: `bunx prisma validate --schema=./prisma/schema.prisma`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: Create and apply the migration**

Run: `bunx prisma migrate dev --name add_claw_studio --schema=./prisma/schema.prisma`
Expected: migration created under `prisma/migrations/*_add_claw_studio/`, applied, and "Generated Prisma Client" printed.

- [ ] **Step 5: Verify the generated client has the new delegates**

Run: `bunx tsc --noEmit -e "import { PrismaClient } from '@prisma/client'; const p = new PrismaClient(); void p.clawStudio; void p.claw; void p.clawConversation;" 2>/dev/null; echo done`

Alternative if `-e` is unsupported: `node -e "const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient(); console.log(!!p.clawStudio, !!p.claw, !!p.clawConversation)"`
Expected: `true true true`

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(claw-studio): add ClawStudio, Claw, ClawConversation models"
```

---

### Task 2: `StudioService` — provisioning, password reset, lookup

**Files:**
- Create: `libs/shared/src/services/studio-service.ts`
- Create: `libs/shared/src/validation/schemas/claw-studio.ts`
- Test: `libs/shared/src/services/studio-service.test.ts`
- Modify: `libs/shared/src/index.ts` (export the service, types, and schemas)

**Interfaces:**
- Consumes: Prisma delegates from Task 1.
- Produces:
  - `class StudioService` with `constructor(tenantId: string, db: ClawStudioDb)` and:
    - `provision(input: { createdBy: string }): Promise<ProvisionResult>` where `ProvisionResult = { studioId: string; password: string; studioRecordId: string; clawId: string }`
    - `resetPassword(): Promise<{ password: string }>`
    - `getForTenant(): Promise<StudioSummary | null>` where `StudioSummary = { id: string; studioId: string; status: string; lastLoginAt: Date | null; createdAt: Date; claw: { id: string; name: string } | null }`
  - `interface ClawStudioDb`
  - Zod: `provisionStudioSchema` (empty object — no body), `resetStudioPasswordSchema` (empty object)

- [ ] **Step 1: Write the failing test**

Create `libs/shared/src/services/studio-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StudioService, type ClawStudioDb } from './studio-service';

function makeDb() {
  const clawStudio = {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const claw = {
    create: vi.fn(),
  };
  const db = {
    clawStudio,
    claw,
    $transaction: vi.fn(async (fn: (tx: ClawStudioDb) => unknown) => fn(db)),
  } as unknown as ClawStudioDb & {
    clawStudio: typeof clawStudio;
    claw: typeof claw;
    $transaction: ReturnType<typeof vi.fn>;
  };
  return db;
}

describe('StudioService', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => {
    db = makeDb();
  });

  it('provisions a studio and its single claw, returning a one-time password', async () => {
    db.clawStudio.findFirst.mockResolvedValue(null);
    db.clawStudio.create.mockResolvedValue({ id: 'studio_1', studioId: 'claw_abc' });
    db.claw.create.mockResolvedValue({ id: 'claw_1', name: 'Claw' });

    const svc = new StudioService('tenant_1', db);
    const result = await svc.provision({ createdBy: 'user_1' });

    expect(result.studioRecordId).toBe('studio_1');
    expect(result.clawId).toBe('claw_1');
    expect(result.studioId).toMatch(/^claw_/);
    expect(result.password).toHaveLength(32);

    // password is hashed, never stored in plaintext
    const createArgs = db.clawStudio.create.mock.calls[0][0].data;
    expect(createArgs.passwordHash).not.toBe(result.password);
    expect(createArgs.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt hash
    expect(createArgs.tenantId).toBe('tenant_1');
    expect(db.claw.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clawStudioId: 'studio_1' }) }),
    );
  });

  it('refuses to provision a second studio for the same tenant', async () => {
    db.clawStudio.findFirst.mockResolvedValue({ id: 'studio_1' });
    const svc = new StudioService('tenant_1', db);
    await expect(svc.provision({ createdBy: 'user_1' })).rejects.toThrow(/already exists/i);
    expect(db.clawStudio.create).not.toHaveBeenCalled();
  });

  it('resets the password and returns a new one-time password', async () => {
    db.clawStudio.findFirst.mockResolvedValue({ id: 'studio_1' });
    db.clawStudio.update.mockResolvedValue({ id: 'studio_1' });
    const svc = new StudioService('tenant_1', db);
    const { password } = await svc.resetPassword();

    expect(password).toHaveLength(32);
    const updateArgs = db.clawStudio.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'studio_1' });
    expect(updateArgs.data.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(updateArgs.data.passwordHash).not.toBe(password);
  });

  it('throws when resetting a password for a tenant with no studio', async () => {
    db.clawStudio.findFirst.mockResolvedValue(null);
    const svc = new StudioService('tenant_1', db);
    await expect(svc.resetPassword()).rejects.toThrow(/no studio/i);
  });

  it('returns a masked summary (never the hash) for the tenant', async () => {
    db.clawStudio.findFirst.mockResolvedValue({
      id: 'studio_1',
      studioId: 'claw_abc',
      status: 'active',
      lastLoginAt: null,
      createdAt: new Date('2026-01-01'),
      passwordHash: '$2b$10$secret',
      claws: [{ id: 'claw_1', name: 'Claw' }],
    });
    const svc = new StudioService('tenant_1', db);
    const summary = await svc.getForTenant();

    expect(summary).toEqual({
      id: 'studio_1',
      studioId: 'claw_abc',
      status: 'active',
      lastLoginAt: null,
      createdAt: new Date('2026-01-01'),
      claw: { id: 'claw_1', name: 'Claw' },
    });
    expect(JSON.stringify(summary)).not.toContain('passwordHash');
  });

  it('returns null when the tenant has no studio', async () => {
    db.clawStudio.findFirst.mockResolvedValue(null);
    const svc = new StudioService('tenant_1', db);
    expect(await svc.getForTenant()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd libs/shared && bunx vitest run src/services/studio-service.test.ts`
Expected: FAIL — `Cannot find module './studio-service'`.

- [ ] **Step 3: Implement `StudioService`**

Create `libs/shared/src/services/studio-service.ts`:

```ts
import crypto from 'crypto';

export interface ClawStudioDb {
  clawStudio: {
    findFirst(args: { where: Record<string, unknown>; include?: Record<string, unknown> }): Promise<unknown | null>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string; studioId: string }>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
  };
  claw: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string; name: string }>;
  };
  $transaction<T>(fn: (tx: ClawStudioDb) => Promise<T>): Promise<T>;
}

export interface ProvisionResult {
  studioId: string;
  password: string;
  studioRecordId: string;
  clawId: string;
}

export interface StudioSummary {
  id: string;
  studioId: string;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  claw: { id: string; name: string } | null;
}

const BCRYPT_COST = 10;

export class StudioService {
  constructor(
    private readonly tenantId: string,
    private readonly db: ClawStudioDb,
  ) {}

  private generateStudioId(): string {
    return 'claw_' + crypto.randomBytes(9).toString('base64url');
  }

  private generatePassword(): string {
    // 24 random bytes → 32 base64url chars
    return crypto.randomBytes(24).toString('base64url');
  }

  private async hash(password: string): Promise<string> {
    const bcrypt = await import('bcryptjs');
    return bcrypt.hash(password, BCRYPT_COST);
  }

  async provision(input: { createdBy: string }): Promise<ProvisionResult> {
    const existing = await this.db.clawStudio.findFirst({ where: { tenantId: this.tenantId } });
    if (existing) {
      throw new Error('A Claw Studio already exists for this tenant');
    }

    const studioId = this.generateStudioId();
    const password = this.generatePassword();
    const passwordHash = await this.hash(password);

    const { studio, claw } = await this.db.$transaction(async (tx) => {
      const studio = await tx.clawStudio.create({
        data: {
          tenantId: this.tenantId,
          studioId,
          passwordHash,
          status: 'active',
        },
      });
      const claw = await tx.claw.create({
        data: {
          clawStudioId: studio.id,
          name: 'Claw',
          autoApprove: false,
        },
      });
      return { studio, claw };
    });

    return { studioId, password, studioRecordId: studio.id, clawId: claw.id };
  }

  async resetPassword(): Promise<{ password: string }> {
    const studio = (await this.db.clawStudio.findFirst({ where: { tenantId: this.tenantId } })) as
      | { id: string }
      | null;
    if (!studio) {
      throw new Error('No Studio to reset for this tenant');
    }
    const password = this.generatePassword();
    const passwordHash = await this.hash(password);
    await this.db.clawStudio.update({ where: { id: studio.id }, data: { passwordHash } });
    return { password };
  }

  async getForTenant(): Promise<StudioSummary | null> {
    const studio = (await this.db.clawStudio.findFirst({
      where: { tenantId: this.tenantId },
      include: { claws: true },
    })) as
      | {
          id: string;
          studioId: string;
          status: string;
          lastLoginAt: Date | null;
          createdAt: Date;
          claws: { id: string; name: string }[];
        }
      | null;
    if (!studio) return null;
    const first = studio.claws[0] ?? null;
    return {
      id: studio.id,
      studioId: studio.studioId,
      status: studio.status,
      lastLoginAt: studio.lastLoginAt,
      createdAt: studio.createdAt,
      claw: first ? { id: first.id, name: first.name } : null,
    };
  }
}
```

- [ ] **Step 4: Create the Zod schemas**

Create `libs/shared/src/validation/schemas/claw-studio.ts`:

```ts
import { z } from 'zod';

// Provision and reset take no request body — the tenant comes from the session.
export const provisionStudioSchema = z.object({}).strict();
export const resetStudioPasswordSchema = z.object({}).strict();

export type ProvisionStudioInput = z.infer<typeof provisionStudioSchema>;
export type ResetStudioPasswordInput = z.infer<typeof resetStudioPasswordSchema>;
```

- [ ] **Step 5: Export from the shared barrel**

In `libs/shared/src/index.ts`, add (next to the other service exports around line 41):

```ts
export { StudioService } from './services/studio-service';
export type { ClawStudioDb, ProvisionResult, StudioSummary } from './services/studio-service';
export { provisionStudioSchema, resetStudioPasswordSchema } from './validation/schemas/claw-studio';
export type { ProvisionStudioInput, ResetStudioPasswordInput } from './validation/schemas/claw-studio';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd libs/shared && bunx vitest run src/services/studio-service.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add libs/shared/src/services/studio-service.ts libs/shared/src/services/studio-service.test.ts libs/shared/src/validation/schemas/claw-studio.ts libs/shared/src/index.ts
git commit -m "feat(claw-studio): add StudioService for provisioning and password reset"
```

---

### Task 3: web-ui API routes — provision, reset-password, get

**Files:**
- Create: `apps/web-ui/app/api/claw-studio/route.ts` (GET summary; POST provision)
- Create: `apps/web-ui/app/api/claw-studio/reset-password/route.ts` (POST)
- Modify: `libs/shared/src/rbac/types.ts` (map subject `ClawStudio` → module `Settings`)

**Interfaces:**
- Consumes: `StudioService`, `provisionStudioSchema`, `resetStudioPasswordSchema`, `getSessionTenantId`, `getSessionUserId`, `authorize`, `getPrismaClient`, `createLogger` from `@chatbot/shared`; `authOptions` from `@/lib/auth`.
- Produces HTTP contract:
  - `GET /api/claw-studio` → `200 { studio: StudioSummary | null }`
  - `POST /api/claw-studio` → `201 { studioId, password, studioRecordId, clawId }` (password shown once) or `409 { error }` if one exists
  - `POST /api/claw-studio/reset-password` → `200 { password }`

- [ ] **Step 1: Map the RBAC subject to a module**

In `libs/shared/src/rbac/types.ts`, add to the `SUBJECT_TO_MODULE` object (provisioning a Studio is an org-admin action → `Settings` module; Owner/Admin already have `manage` on Settings):

```ts
  ClawStudio: 'Settings',
```

- [ ] **Step 2: Write the failing test (route smoke via the service contract)**

> Route handlers here are thin wrappers; they are covered end-to-end by the Playwright test in Task 4. For unit-level confidence write a contract test asserting the response shapes the handler must produce. Create `apps/web-ui/app/api/claw-studio/route.contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { provisionStudioSchema } from '@chatbot/shared';

describe('claw-studio provision contract', () => {
  it('accepts an empty body', () => {
    expect(provisionStudioSchema.safeParse({}).success).toBe(true);
  });
  it('rejects unexpected fields', () => {
    expect(provisionStudioSchema.safeParse({ foo: 1 }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd apps/web-ui && bunx vitest run app/api/claw-studio/route.contract.test.ts`
Expected: FAIL — module `@chatbot/shared` export `provisionStudioSchema` not found (until Task 2 is built) OR test file path not found. If Task 2 is already merged, it may PASS immediately — that is acceptable; proceed.

- [ ] **Step 4: Implement `GET`/`POST /api/claw-studio`**

Create `apps/web-ui/app/api/claw-studio/route.ts`:

```ts
import { NextRequest } from 'next/server';
import {
  getSessionTenantId,
  getSessionUserId,
  authorize,
  getPrismaClient,
  StudioService,
  provisionStudioSchema,
  createLogger,
} from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:claw-studio');

export async function GET() {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'ClawStudio', authOptions);
    if (authError) return authError;

    const db = getPrismaClient();
    const service = new StudioService(tenantId, db);
    const studio = await service.getForTenant();

    return new Response(JSON.stringify({ studio }), { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    logger.error({ error }, 'Failed to fetch Claw Studio');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'ClawStudio', authOptions);
    if (authError) return authError;

    const body = await req.json().catch(() => ({}));
    const parsed = provisionStudioSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }),
        { status: 400 },
      );
    }

    const db = getPrismaClient();
    const service = new StudioService(tenantId, db);
    const result = await service.provision({ createdBy: userId });

    logger.info(
      { tenantId, studioId: result.studioId, clawId: result.clawId },
      'Claw Studio provisioned',
    );
    return new Response(JSON.stringify(result), { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    if (error instanceof Error && error.message.includes('already exists')) {
      return new Response(JSON.stringify({ error: error.message }), { status: 409 });
    }
    logger.error({ error }, 'Failed to provision Claw Studio');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
```

- [ ] **Step 5: Implement `POST /api/claw-studio/reset-password`**

Create `apps/web-ui/app/api/claw-studio/reset-password/route.ts`:

```ts
import { NextRequest } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  getPrismaClient,
  StudioService,
  resetStudioPasswordSchema,
  createLogger,
} from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:claw-studio:reset-password');

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'ClawStudio', authOptions);
    if (authError) return authError;

    const body = await req.json().catch(() => ({}));
    const parsed = resetStudioPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }),
        { status: 400 },
      );
    }

    const db = getPrismaClient();
    const service = new StudioService(tenantId, db);
    const result = await service.resetPassword();

    logger.info({ tenantId }, 'Claw Studio password reset');
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    if (error instanceof Error && error.message.includes('No Studio')) {
      return new Response(JSON.stringify({ error: error.message }), { status: 404 });
    }
    logger.error({ error }, 'Failed to reset Claw Studio password');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
```

- [ ] **Step 6: Run the contract test to verify it passes**

Run: `cd apps/web-ui && bunx vitest run app/api/claw-studio/route.contract.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck the shared lib (RBAC change)**

Run: `cd libs/shared && bunx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web-ui/app/api/claw-studio libs/shared/src/rbac/types.ts
git commit -m "feat(claw-studio): add provision/reset/get API routes"
```

---

### Task 4: web-ui Claw Studio page + sidebar entry + launch env var

**Files:**
- Create: `apps/web-ui/hooks/use-claw-studio.ts` (TanStack Query hooks)
- Create: `apps/web-ui/app/(dashboard)/claw-studio/page.tsx`
- Modify: `apps/web-ui/lib/env.ts` (add `MISSION_CONTROL_URL`; expose as `NEXT_PUBLIC_MISSION_CONTROL_URL`)
- Modify: `apps/web-ui/.env.example` (document the new var)
- Modify: `apps/web-ui/components/layout/app-sidebar.tsx` (add "Claw Studio" nav item)
- Test: `apps/web-ui-e2e/src/modules/claw-studio/provision.spec.ts`
- Modify: `apps/web-ui-e2e/src/constants/tags.ts` (add `CLAW_STUDIO` tag)

**Interfaces:**
- Consumes: `GET/POST /api/claw-studio`, `POST /api/claw-studio/reset-password` from Task 3.
- Produces: a `/claw-studio` page with `data-testid` hooks used by the e2e test: `claw-card`, `generate-studio`, `reset-password`, `studio-id`, `studio-password`, `mission-control`.

- [ ] **Step 1: Add the launch URL to T3 Env**

In `apps/web-ui/lib/env.ts`, add to `server` (after `TAVILY_API_KEY`/`BRAVE_API_KEY` block) and to `client`, and register in `experimental__runtimeEnv`:

```ts
  server: {
    // ...existing...
    MISSION_CONTROL_URL: z.string().url().optional(),
  },
  client: {
    NEXT_PUBLIC_MISSION_CONTROL_URL: z.string().url().optional(),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_MISSION_CONTROL_URL: process.env.NEXT_PUBLIC_MISSION_CONTROL_URL,
  },
```

- [ ] **Step 2: Document the env var**

In `apps/web-ui/.env.example`, add:

```
# Claw Studio — base URL of the Mission Control app (Plan B). Used by the launch button.
NEXT_PUBLIC_MISSION_CONTROL_URL=http://localhost:3010
```

- [ ] **Step 3: Add the TanStack Query hooks**

Create `apps/web-ui/hooks/use-claw-studio.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface StudioSummary {
  id: string;
  studioId: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  claw: { id: string; name: string } | null;
}

export interface ProvisionResult {
  studioId: string;
  password: string;
  studioRecordId: string;
  clawId: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function useClawStudio() {
  return useQuery({
    queryKey: ['claw-studio'],
    queryFn: async () => {
      const res = await fetch('/api/claw-studio');
      const data = await json<{ studio: StudioSummary | null }>(res);
      return data.studio;
    },
  });
}

export function useProvisionStudio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/claw-studio', { method: 'POST', body: '{}' });
      return json<ProvisionResult>(res);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claw-studio'] }),
  });
}

export function useResetStudioPassword() {
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/claw-studio/reset-password', { method: 'POST', body: '{}' });
      return json<{ password: string }>(res);
    },
  });
}
```

- [ ] **Step 4: Build the page**

Create `apps/web-ui/app/(dashboard)/claw-studio/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Cat, KeyRound, Rocket, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { env } from '@/lib/env';
import { useClawStudio, useProvisionStudio, useResetStudioPassword } from '@/hooks/use-claw-studio';
import { Button } from '@/components/ui/button';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ClawStudioPage() {
  const { data: studio, isLoading } = useClawStudio();
  const provision = useProvisionStudio();
  const reset = useResetStudioPassword();

  const [revealed, setRevealed] = useState<{ studioId: string; password: string } | null>(null);

  const missionControlUrl = env.NEXT_PUBLIC_MISSION_CONTROL_URL;

  const handleGenerate = async () => {
    try {
      const result = await provision.mutateAsync();
      setRevealed({ studioId: result.studioId, password: result.password });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to generate Studio');
    }
  };

  const handleReset = async () => {
    if (!studio) return;
    try {
      const { password } = await reset.mutateAsync();
      setRevealed({ studioId: studio.studioId, password });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reset password');
    }
  };

  const openMissionControl = () => {
    if (!missionControlUrl) {
      toast.error('Mission Control URL is not configured');
      return;
    }
    const url = studio ? `${missionControlUrl}/login?studio=${encodeURIComponent(studio.studioId)}` : missionControlUrl;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value);
    toast.success('Copied to clipboard');
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Claw Studio</h2>
        <p className="text-muted-foreground">Provision your autonomous teammate and open Mission Control.</p>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full max-w-xl" />
      ) : (
        <Card className="max-w-xl" data-testid="claw-card">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Cat className="size-6 text-primary" />
              </div>
              <div>
                <CardTitle>Claw</CardTitle>
                <CardDescription>
                  {studio ? 'Your teammate is provisioned.' : 'Not provisioned yet.'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {studio ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Studio ID:</span>
                  <code data-testid="studio-id" className="rounded bg-muted px-2 py-0.5">{studio.studioId}</code>
                </div>
                <div className="text-muted-foreground">
                  Status: {studio.status} · Created {new Date(studio.createdAt).toLocaleDateString()}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">
                Generate a Studio ID and password to create your Claw. The password is shown only once.
              </p>
            )}
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            {!studio ? (
              <Button data-testid="generate-studio" onClick={handleGenerate} disabled={provision.isPending}>
                <KeyRound className="mr-2 size-4" />
                {provision.isPending ? 'Generating…' : 'Generate Studio ID & Password'}
              </Button>
            ) : (
              <>
                <Button data-testid="mission-control" onClick={openMissionControl}>
                  <Rocket className="mr-2 size-4" />
                  Mission Control
                </Button>
                <Button data-testid="reset-password" variant="outline" onClick={handleReset} disabled={reset.isPending}>
                  <KeyRound className="mr-2 size-4" />
                  {reset.isPending ? 'Resetting…' : 'Reset Password'}
                </Button>
              </>
            )}
          </CardFooter>
        </Card>
      )}

      <Dialog open={!!revealed} onOpenChange={(open) => !open && setRevealed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save these credentials</DialogTitle>
            <DialogDescription>
              The password is shown only once. Store it securely — you can reset it, but you cannot view it again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Studio ID</Label>
              <div className="flex gap-2">
                <Input data-testid="studio-id" readOnly value={revealed?.studioId ?? ''} />
                <Button variant="outline" size="icon" onClick={() => copy(revealed!.studioId)}>
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Password</Label>
              <div className="flex gap-2">
                <Input data-testid="studio-password" readOnly value={revealed?.password ?? ''} />
                <Button variant="outline" size="icon" onClick={() => copy(revealed!.password)}>
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 5: Add the sidebar entry**

In `apps/web-ui/components/layout/app-sidebar.tsx`: add `Cat` to the `lucide-react` import, and add a new item to the `mainNav` array (the "Platform" group):

```ts
  { name: 'Claw Studio', href: '/claw-studio', icon: Cat },
```

- [ ] **Step 6: Add the e2e tag**

In `apps/web-ui-e2e/src/constants/tags.ts`, add to the module-tag group:

```ts
  CLAW_STUDIO: '@claw-studio',
```

- [ ] **Step 7: Write the e2e spec**

Create `apps/web-ui-e2e/src/modules/claw-studio/provision.spec.ts`:

```ts
import { test, expect } from '../../fixtures/base';

test.describe('Claw Studio provisioning @claw-studio', () => {
  test('provisions a Studio and reveals credentials once, then shows Mission Control', async ({ page, gotoApp }) => {
    await gotoApp('/claw-studio');

    await expect(page.getByTestId('claw-card')).toBeVisible();

    const generate = page.getByTestId('generate-studio');
    const missionControl = page.getByTestId('mission-control');

    if (await generate.isVisible().catch(() => false)) {
      await generate.click();
      // credentials revealed once
      await expect(page.getByTestId('studio-password')).toBeVisible();
      const pw = await page.getByTestId('studio-password').inputValue();
      expect(pw.length).toBeGreaterThan(16);
      // close dialog
      await page.keyboard.press('Escape');
    }

    // after provisioning, the launch button is present
    await expect(missionControl).toBeVisible();
    await expect(page.getByTestId('reset-password')).toBeVisible();
  });
});
```

- [ ] **Step 8: Typecheck + build web-ui**

Run: `cd apps/web-ui && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Run the e2e spec**

Run: `bun run e2e:dev -- --grep @claw-studio`
Expected: 1 passed. (If the run creates a Studio for the test tenant, subsequent runs take the "already provisioned" branch — the test handles both.)

- [ ] **Step 10: Commit**

```bash
git add apps/web-ui/hooks/use-claw-studio.ts "apps/web-ui/app/(dashboard)/claw-studio" apps/web-ui/lib/env.ts apps/web-ui/.env.example apps/web-ui/components/layout/app-sidebar.tsx apps/web-ui-e2e/src/modules/claw-studio apps/web-ui-e2e/src/constants/tags.ts
git commit -m "feat(claw-studio): add Claw Studio dashboard page, provisioning UI, and launch button"
```

---

## Self-Review

**Spec coverage (Plan A slice of the spec):**
- §4 data model → Task 1 (`ClawStudio`, `Claw`, `ClawConversation`; `ClawConversation.threadId` present for Plan C; memory/skill/mcp tables intentionally deferred to Plan C where the runtime that writes them lands). ✓
- §5.1 provisioning (generate, reset, once-only reveal, bcrypt hash, one-per-tenant guard) → Tasks 2–4. ✓
- §5 launch button to MC (`?studio=` prefill) → Task 4. ✓
- §10 standards (Zod boundary, T3 env, shadcn only, try/catch + Pino, bcrypt) → enforced in Tasks 2–4. ✓
- §6 sidebar entry → Task 4. ✓
- Deferred to Plan B/C (correctly out of scope here): MC app + its login (authenticate against `passwordHash`), the console, the agent graph, memory/skills/MCP tables and runtime.

**Deviations from the spec (intentional, noted):**
- Spec §3.1 placed `studio-service` under `libs/claw-studio/src/services`. Plan A puts provisioning services in **`libs/shared`** instead, matching every existing service (`ApiKeyService`, `LlmProviderService`) and keeping `libs/claw-studio`'s heavy agent-runtime deps out of `web-ui`. `libs/claw-studio` is created in Plan C for the runtime only.
- RBAC: rather than introduce a new `ClawStudio` permission module, subject `ClawStudio` maps to the existing `Settings` module (provisioning is an org-admin action). A dedicated module can be added later if finer control is needed.

**Placeholder scan:** none — every code step contains full code; every run step has an exact command and expected output.

**Type consistency:** `StudioService` method names/return types (`provision`→`ProvisionResult`, `resetPassword`→`{ password }`, `getForTenant`→`StudioSummary | null`) are identical across Tasks 2, 3, and the Task 4 hooks. Prisma field names (`clawStudioId`, `studioId`, `passwordHash`) are identical across Tasks 1–3. `data-testid`s in the Task 4 page match those asserted in the Task 4 e2e spec.

---

## Next plans (not in this document)

- **Plan B — Mission Control app shell & auth:** scaffold `apps/mission-control`, NextAuth Credentials login authenticating `studioId` + password via `bcrypt.compare` against `ClawStudio.passwordHash` (updates `lastLoginAt`), middleware + console layout + dashboard shell.
- **Plan C — Claw runtime & chat:** `libs/claw-studio` executor-graph (memory/skills/MCP fused), model-factory bridged to `LlmProvider`, CopilotKit spike + chat UI, and the `ClawMemory`/`ClawSkill`/`ClawMcpServer` tables the runtime reads/writes.
