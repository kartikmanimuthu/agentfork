# Agent Studio Integration: Knowledge Base, MCP, Versioning & Aliases

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Knowledge Bases to agents, build a Versions tab with alias management (dev/prod/ut), and integrate KB retrieval into inference so users can iterate configs and test via aliases.

**Architecture:** Two new Prisma models (`AgentKnowledgeBase`, `AgentAlias`) plus two new services (`AgentAliasService`, `KnowledgeBaseAttachmentService`). Inference resolves alias → version → config, then fetches attached KBs and injects retrieved chunks into the system prompt. Frontend replaces "coming soon" tabs with working multi-select and version tables.

**Tech Stack:** Next.js 15 App Router, Prisma, PostgreSQL/pgvector, React Query (TanStack), shadcn/ui, Zustand, `@chatbot/agent-studio`, `@chatbot/knowledge-base`, `@chatbot/shared`, `@chatbot/ai`.

---

## File Structure Map

| File | Responsibility |
|------|---------------|
| `prisma/schema.prisma` | Add `AgentKnowledgeBase`, `AgentAlias`, relations |
| `libs/agent-studio/src/services/agent-alias-service.ts` | CRUD + resolution logic for aliases |
| `libs/agent-studio/src/services/agent-alias-service.test.ts` | Unit tests |
| `libs/agent-studio/src/services/kb-attachment-service.ts` | Attach/detach/list KBs for an agent |
| `libs/agent-studio/src/services/kb-attachment-service.test.ts` | Unit tests |
| `libs/agent-studio/src/types/alias.ts` | Alias types |
| `libs/agent-studio/src/types/kb-attachment.ts` | KB attachment types |
| `libs/agent-studio/src/index.ts` | Export new services and types |
| `apps/web-ui/app/api/agents/[id]/knowledge-bases/route.ts` | GET / POST attached KBs |
| `apps/web-ui/app/api/agents/[id]/knowledge-bases/[kbId]/route.ts` | DELETE attached KB |
| `apps/web-ui/app/api/agents/[id]/versions/route.ts` | Extend with alias info |
| `apps/web-ui/app/api/agents/[id]/versions/[versionId]/publish/route.ts` | Publish version |
| `apps/web-ui/app/api/agents/[id]/aliases/route.ts` | GET / POST aliases |
| `apps/web-ui/app/api/agents/[id]/aliases/[aliasId]/route.ts` | PUT / DELETE alias |
| `apps/web-ui/app/api/agents/[id]/playground/route.ts` | Accept `alias` param |
| `apps/web-ui/app/api/v1/inference/route.ts` | Resolve alias/version, KB retrieval |
| `apps/web-ui/hooks/use-agent-knowledge-bases.ts` | React Query hooks for KB attachments |
| `apps/web-ui/hooks/use-agent-aliases.ts` | React Query hooks for aliases |
| `apps/web-ui/hooks/use-agent-versions.ts` | Extend with publish + alias data |
| `apps/web-ui/components/agents/tabs/knowledge-bases-tab.tsx` | KB multi-select UI |
| `apps/web-ui/components/agents/tabs/versions-tab.tsx` | Version list + actions |
| `apps/web-ui/components/agents/tabs/alias-manager.tsx` | Create/edit aliases |
| `apps/web-ui/components/agents/playground/version-selector.tsx` | Playground version picker |
| `apps/web-ui/app/(dashboard)/agents/[id]/page.tsx` | Replace placeholders |

---

## Task 1: Prisma Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`

**Goal:** Add `AgentKnowledgeBase`, `AgentAlias` models and wire relations.

- [ ] **Step 1: Add `AgentKnowledgeBase` model**

Insert after the `AgentMcpServer` model (around line 422):

```prisma
model AgentKnowledgeBase {
  id              String   @id @default(cuid())
  agentId         String
  knowledgeBaseId String
  createdAt       DateTime @default(now())

  agent         Agent         @relation(fields: [agentId], references: [id], onDelete: Cascade)
  knowledgeBase KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)

  @@unique([agentId, knowledgeBaseId])
  @@index([agentId])
  @@index([knowledgeBaseId])
  @@map("agent_knowledge_bases")
}
```

- [ ] **Step 2: Add `AgentAlias` model**

Insert after `AgentKnowledgeBase`:

```prisma
model AgentAlias {
  id        String   @id @default(cuid())
  agentId   String
  name      String
  versionId String
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  agent   Agent        @relation(fields: [agentId], references: [id], onDelete: Cascade)
  version AgentVersion @relation(fields: [versionId], references: [id], onDelete: Restrict)

  @@unique([agentId, name])
  @@index([agentId])
  @@index([versionId])
  @@map("agent_aliases")
}
```

- [ ] **Step 3: Wire relations on existing models**

On `Agent` model (around line 276), add to the relation list:
```prisma
  knowledgeBases    AgentKnowledgeBase[]
  aliases           AgentAlias[]
```

On `KnowledgeBase` model (around line 521), add:
```prisma
  agents            AgentKnowledgeBase[]
```

On `AgentVersion` model (around line 302), add:
```prisma
  aliases           AgentAlias[]
```

- [ ] **Step 4: Generate migration**

Run:
```bash
bunx prisma migrate dev --name agent_kb_alias_integration
```

Expected: Migration created and applied successfully.

- [ ] **Step 5: Regenerate Prisma client**

```bash
bunx prisma generate --schema=./prisma/schema.prisma
```

- [ ] **Step 6: Commit**

```bash
git add prisma/
git commit -m "feat(db): add AgentKnowledgeBase and AgentAlias models

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: AgentAliasService

**Files:**
- Create: `libs/agent-studio/src/services/agent-alias-service.ts`
- Create: `libs/agent-studio/src/services/agent-alias-service.test.ts`
- Create: `libs/agent-studio/src/types/alias.ts`
- Modify: `libs/agent-studio/src/index.ts`

**Goal:** Service for creating, updating, deleting, and resolving aliases.

- [ ] **Step 1: Write failing test**

`libs/agent-studio/src/services/agent-alias-service.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AgentAliasService } from './agent-alias-service';

function mockDb(overrides: Record<string, unknown> = {}) {
  return {
    agentAlias: {
      create: vi.fn(async (args: any) => ({ id: 'alias-1', ...args.data })),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      update: vi.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
      delete: vi.fn(async () => ({})),
      count: vi.fn(async () => 0),
    },
    agentVersion: {
      findFirst: vi.fn(async () => ({ id: 'v1', status: 'published', config: {} })),
    },
    agent: {
      findFirst: vi.fn(async () => ({ id: 'agent-1', config: {} })),
    },
    ...overrides,
  };
}

describe('AgentAliasService', () => {
  it('creates an alias', async () => {
    const db = mockDb();
    const service = new AgentAliasService('tenant-1', db as any);
    const result = await service.createAlias('agent-1', 'dev', 'v1');
    expect(db.agentAlias.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ agentId: 'agent-1', name: 'dev', versionId: 'v1', isDefault: false }),
    }));
    expect(result).toMatchObject({ agentId: 'agent-1', name: 'dev', versionId: 'v1' });
  });

  it('sets isDefault to true when it is the first alias', async () => {
    const db = mockDb();
    db.agentAlias.count = vi.fn(async () => 0);
    const service = new AgentAliasService('tenant-1', db as any);
    await service.createAlias('agent-1', 'dev', 'v1');
    expect(db.agentAlias.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isDefault: true }),
    }));
  });

  it('resolves alias to version config', async () => {
    const db = mockDb();
    db.agentAlias.findFirst = vi.fn(async () => ({ id: 'alias-1', versionId: 'v1', version: { id: 'v1', config: { model: 'gpt-4' } } }));
    const service = new AgentAliasService('tenant-1', db as any);
    const result = await service.resolveAlias('agent-1', 'dev');
    expect(result).toMatchObject({ versionId: 'v1', config: { model: 'gpt-4' } });
  });

  it('resolves default alias when no name provided', async () => {
    const db = mockDb();
    db.agentAlias.findFirst = vi.fn(async () => ({ id: 'alias-1', versionId: 'v1', version: { id: 'v1', config: {} } }));
    const service = new AgentAliasService('tenant-1', db as any);
    const result = await service.resolveAlias('agent-1');
    expect(db.agentAlias.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ agentId: 'agent-1', isDefault: true }),
    }));
    expect(result).toMatchObject({ versionId: 'v1' });
  });
});
```

Run:
```bash
bunx vitest run libs/agent-studio/src/services/agent-alias-service.test.ts
```
Expected: FAIL — `AgentAliasService` not found.

- [ ] **Step 2: Implement AgentAliasService**

`libs/agent-studio/src/services/agent-alias-service.ts`:

```typescript
import type { AgentAlias } from '../types/alias';

export interface AgentAliasPrismaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  findFirst(args: { where: Record<string, unknown>; include?: Record<string, unknown> }): Promise<unknown | null>;
  findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<unknown[]>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
  delete(args: { where: Record<string, unknown> }): Promise<unknown>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

export interface AgentVersionPrismaDelegate {
  findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
}

export interface AgentAliasDb {
  agentAlias: AgentAliasPrismaDelegate;
  agentVersion: AgentVersionPrismaDelegate;
}

export class AgentAliasService {
  constructor(
    private readonly tenantId: string,
    private readonly db: AgentAliasDb
  ) {}

  async createAlias(agentId: string, name: string, versionId: string, isDefault?: boolean) {
    // Verify version exists and belongs to agent
    const version = await this.db.agentVersion.findFirst({
      where: { id: versionId, agentId },
    });
    if (!version) {
      throw new Error('Version not found for this agent');
    }

    // If this is the first alias for the agent, make it default
    const aliasCount = await this.db.agentAlias.count({ where: { agentId } });
    const shouldBeDefault = isDefault ?? aliasCount === 0;

    if (shouldBeDefault) {
      await this.clearOtherDefaults(agentId);
    }

    return this.db.agentAlias.create({
      data: {
        agentId,
        name,
        versionId,
        isDefault: shouldBeDefault,
      },
    }) as Promise<AgentAlias>;
  }

  async findByAgentId(agentId: string) {
    return this.db.agentAlias.findMany({
      where: { agentId },
      orderBy: { createdAt: 'asc' },
      include: { version: { select: { version: true, status: true } } },
    }) as Promise<(AgentAlias & { version: { version: number; status: string } })[]>;
  }

  async updateAlias(id: string, updates: { versionId?: string; isDefault?: boolean }) {
    if (updates.isDefault) {
      const alias = await this.db.agentAlias.findFirst({ where: { id } }) as AgentAlias | null;
      if (alias) {
        await this.clearOtherDefaults(alias.agentId);
      }
    }

    return this.db.agentAlias.update({
      where: { id },
      data: {
        ...(updates.versionId !== undefined && { versionId: updates.versionId }),
        ...(updates.isDefault !== undefined && { isDefault: updates.isDefault }),
      },
    }) as Promise<AgentAlias>;
  }

  async deleteAlias(id: string) {
    const alias = await this.db.agentAlias.findFirst({ where: { id } }) as AgentAlias | null;
    if (!alias) throw new Error('Alias not found');

    await this.db.agentAlias.delete({ where: { id } });

    // If deleted alias was default, set the oldest remaining as default
    if (alias.isDefault) {
      const remaining = await this.db.agentAlias.findMany({
        where: { agentId: alias.agentId },
        orderBy: { createdAt: 'asc' },
        take: 1,
      }) as AgentAlias[];

      if (remaining.length > 0) {
        await this.db.agentAlias.update({
          where: { id: remaining[0].id },
          data: { isDefault: true },
        });
      }
    }
  }

  async resolveAlias(agentId: string, aliasName?: string) {
    const alias = aliasName
      ? await this.db.agentAlias.findFirst({
          where: { agentId, name: aliasName },
          include: { version: true },
        })
      : await this.db.agentAlias.findFirst({
          where: { agentId, isDefault: true },
          include: { version: true },
        });

    if (!alias) {
      throw new Error(aliasName ? `Alias '${aliasName}' not found` : 'No default alias configured');
    }

    const { version } = alias as { version: { id: string; config: unknown } };
    return {
      aliasId: (alias as AgentAlias).id,
      aliasName: (alias as AgentAlias).name,
      versionId: version.id,
      config: version.config as Record<string, unknown>,
    };
  }

  private async clearOtherDefaults(agentId: string) {
    const defaults = await this.db.agentAlias.findMany({
      where: { agentId, isDefault: true },
    }) as AgentAlias[];

    for (const d of defaults) {
      await this.db.agentAlias.update({
        where: { id: d.id },
        data: { isDefault: false },
      });
    }
  }
}
```

- [ ] **Step 3: Add types**

`libs/agent-studio/src/types/alias.ts`:

```typescript
export interface AgentAlias {
  id: string;
  agentId: string;
  name: string;
  versionId: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAliasInput {
  agentId: string;
  name: string;
  versionId: string;
  isDefault?: boolean;
}

export interface UpdateAliasInput {
  versionId?: string;
  isDefault?: boolean;
}
```

- [ ] **Step 4: Update exports**

`libs/agent-studio/src/index.ts`, append after line 60:

```typescript
// Alias types
export type { AgentAlias, CreateAliasInput, UpdateAliasInput } from './types/alias';

// Alias service
export { AgentAliasService } from './services/agent-alias-service';
export type { AgentAliasDb } from './services/agent-alias-service';
```

- [ ] **Step 5: Run tests**

```bash
bunx vitest run libs/agent-studio/src/services/agent-alias-service.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add libs/agent-studio/src/
git commit -m "feat(agent-studio): add AgentAliasService with tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: KnowledgeBaseAttachmentService

**Files:**
- Create: `libs/agent-studio/src/services/kb-attachment-service.ts`
- Create: `libs/agent-studio/src/services/kb-attachment-service.test.ts`
- Create: `libs/agent-studio/src/types/kb-attachment.ts`
- Modify: `libs/agent-studio/src/index.ts`

**Goal:** Service for attaching/detaching/listing Knowledge Bases on agents.

- [ ] **Step 1: Write failing test**

`libs/agent-studio/src/services/kb-attachment-service.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { KnowledgeBaseAttachmentService } from './kb-attachment-service';

function mockDb() {
  return {
    agentKnowledgeBase: {
      create: vi.fn(async (args: any) => ({ id: 'akb-1', ...args.data })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => [
        { id: 'akb-1', agentId: 'agent-1', knowledgeBaseId: 'kb-1', knowledgeBase: { id: 'kb-1', name: 'Docs', status: 'active' } },
      ]),
    },
    knowledgeBase: {
      findFirst: vi.fn(async () => ({ id: 'kb-1', tenantId: 'tenant-1', status: 'active' })),
    },
  };
}

describe('KnowledgeBaseAttachmentService', () => {
  it('attaches a KB', async () => {
    const db = mockDb();
    const service = new KnowledgeBaseAttachmentService('tenant-1', db as any);
    const result = await service.attach('agent-1', 'kb-1');
    expect(db.agentKnowledgeBase.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { agentId: 'agent-1', knowledgeBaseId: 'kb-1' },
    }));
    expect(result).toMatchObject({ agentId: 'agent-1', knowledgeBaseId: 'kb-1' });
  });

  it('throws if KB does not belong to tenant', async () => {
    const db = mockDb();
    db.knowledgeBase.findFirst = vi.fn(async () => ({ id: 'kb-1', tenantId: 'other-tenant', status: 'active' }));
    const service = new KnowledgeBaseAttachmentService('tenant-1', db as any);
    await expect(service.attach('agent-1', 'kb-1')).rejects.toThrow('Knowledge base not found');
  });

  it('lists attached KBs', async () => {
    const db = mockDb();
    const service = new KnowledgeBaseAttachmentService('tenant-1', db as any);
    const result = await service.findAttached('agent-1');
    expect(db.agentKnowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId: 'agent-1' },
      include: { knowledgeBase: true },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'akb-1', knowledgeBase: { name: 'Docs' } });
  });

  it('detaches a KB', async () => {
    const db = mockDb();
    const service = new KnowledgeBaseAttachmentService('tenant-1', db as any);
    await service.detach('agent-1', 'kb-1');
    expect(db.agentKnowledgeBase.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId: 'agent-1', knowledgeBaseId: 'kb-1' },
    }));
  });
});
```

Run:
```bash
bunx vitest run libs/agent-studio/src/services/kb-attachment-service.test.ts
```
Expected: FAIL — service not found.

- [ ] **Step 2: Implement KnowledgeBaseAttachmentService**

`libs/agent-studio/src/services/kb-attachment-service.ts`:

```typescript
export interface AgentKnowledgeBasePrismaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
  findMany(args: { where: Record<string, unknown>; include?: Record<string, unknown> }): Promise<unknown[]>;
}

export interface KnowledgeBasePrismaDelegate {
  findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
}

export interface KbAttachmentDb {
  agentKnowledgeBase: AgentKnowledgeBasePrismaDelegate;
  knowledgeBase: KnowledgeBasePrismaDelegate;
}

export class KnowledgeBaseAttachmentService {
  constructor(
    private readonly tenantId: string,
    private readonly db: KbAttachmentDb
  ) {}

  async attach(agentId: string, knowledgeBaseId: string) {
    const kb = await this.db.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, tenantId: this.tenantId },
    });
    if (!kb) {
      throw new Error('Knowledge base not found');
    }

    return this.db.agentKnowledgeBase.create({
      data: { agentId, knowledgeBaseId },
    });
  }

  async detach(agentId: string, knowledgeBaseId: string) {
    return this.db.agentKnowledgeBase.deleteMany({
      where: { agentId, knowledgeBaseId },
    });
  }

  async findAttached(agentId: string) {
    return this.db.agentKnowledgeBase.findMany({
      where: { agentId },
      include: { knowledgeBase: true },
      orderBy: { createdAt: 'desc' },
    }) as Promise<Array<Record<string, unknown> & { knowledgeBase: Record<string, unknown> }>>;
  }
}
```

- [ ] **Step 3: Add types**

`libs/agent-studio/src/types/kb-attachment.ts`:

```typescript
export interface AgentKnowledgeBaseAttachment {
  id: string;
  agentId: string;
  knowledgeBaseId: string;
  createdAt: Date;
}

export interface AttachedKnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  status: string;
  documentCount: number;
  chunkCount: number;
}
```

- [ ] **Step 4: Update exports**

`libs/agent-studio/src/index.ts`, append:

```typescript
// KB Attachment types
export type { AgentKnowledgeBaseAttachment, AttachedKnowledgeBase } from './types/kb-attachment';

// KB Attachment service
export { KnowledgeBaseAttachmentService } from './services/kb-attachment-service';
export type { KbAttachmentDb } from './services/kb-attachment-service';
```

- [ ] **Step 5: Run tests**

```bash
bunx vitest run libs/agent-studio/src/services/kb-attachment-service.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add libs/agent-studio/src/
git commit -m "feat(agent-studio): add KnowledgeBaseAttachmentService with tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: API Routes — Knowledge Base Attachment

**Files:**
- Create: `apps/web-ui/app/api/agents/[id]/knowledge-bases/route.ts`
- Create: `apps/web-ui/app/api/agents/[id]/knowledge-bases/[kbId]/route.ts`

**Goal:** Dashboard API for attaching/detaching KBs.

- [ ] **Step 1: Create GET/POST route**

`apps/web-ui/app/api/agents/[id]/knowledge-bases/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { KnowledgeBaseAttachmentService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();
    const service = new KnowledgeBaseAttachmentService(tenantId, db as any);
    const items = await service.findAttached(id);

    return NextResponse.json(items);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const { knowledgeBaseId } = await req.json();
    const db = getPrismaClient();
    const service = new KnowledgeBaseAttachmentService(tenantId, db as any);

    const result = await service.attach(id, knowledgeBaseId);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Knowledge base already attached' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create DELETE route**

`apps/web-ui/app/api/agents/[id]/knowledge-bases/[kbId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { KnowledgeBaseAttachmentService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; kbId: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id, kbId } = await params;
    const db = getPrismaClient();
    const service = new KnowledgeBaseAttachmentService(tenantId, db as any);

    await service.detach(id, kbId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/app/api/agents/
git commit -m "feat(api): add agent knowledge base attachment routes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: API Routes — Versions with Alias Info

**Files:**
- Modify: `apps/web-ui/app/api/agents/[id]/versions/route.ts`

**Goal:** Extend existing versions endpoint to include alias mappings.

- [ ] **Step 1: Modify GET route**

Replace the `GET` handler in `apps/web-ui/app/api/agents/[id]/versions/route.ts`:

```typescript
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'AgentVersion', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();

    const versions = await db.agentVersion.findMany({
      where: { agentId: id },
      orderBy: { version: 'desc' },
      include: { aliases: { select: { id: true, name: true, isDefault: true } } },
    });

    return NextResponse.json(versions);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create publish route**

`apps/web-ui/app/api/agents/[id]/versions/[versionId]/publish/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { AgentVersionService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'AgentVersion', authOptions);
    if (authError) return authError;

    const { versionId } = await params;
    const db = getPrismaClient();
    const service = new AgentVersionService(db as any);

    const version = await service.publish(versionId);
    return NextResponse.json(version);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/app/api/agents/
git commit -m "feat(api): extend versions endpoint with aliases, add publish route

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: API Routes — Aliases

**Files:**
- Create: `apps/web-ui/app/api/agents/[id]/aliases/route.ts`
- Create: `apps/web-ui/app/api/agents/[id]/aliases/[aliasId]/route.ts`

**Goal:** CRUD routes for agent aliases.

- [ ] **Step 1: Create GET/POST aliases route**

`apps/web-ui/app/api/agents/[id]/aliases/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { AgentAliasService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();
    const service = new AgentAliasService(tenantId, db as any);
    const aliases = await service.findByAgentId(id);

    return NextResponse.json(aliases);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const { name, versionId, isDefault } = await req.json();
    const db = getPrismaClient();
    const service = new AgentAliasService(tenantId, db as any);

    const alias = await service.createAlias(id, name, versionId, isDefault);
    return NextResponse.json(alias, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Alias name already exists for this agent' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create PUT/DELETE alias route**

`apps/web-ui/app/api/agents/[id]/aliases/[aliasId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { AgentAliasService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; aliasId: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { aliasId } = await params;
    const { versionId, isDefault } = await req.json();
    const db = getPrismaClient();
    const service = new AgentAliasService(tenantId, db as any);

    const alias = await service.updateAlias(aliasId, { versionId, isDefault });
    return NextResponse.json(alias);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; aliasId: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { aliasId } = await params;
    const db = getPrismaClient();
    const service = new AgentAliasService(tenantId, db as any);

    await service.deleteAlias(aliasId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/app/api/agents/
git commit -m "feat(api): add agent alias CRUD routes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Inference Integration — Alias Resolution + KB Retrieval

**Files:**
- Modify: `apps/web-ui/app/api/v1/inference/route.ts`
- Modify: `apps/web-ui/app/api/agents/[id]/playground/route.ts`

**Goal:** Accept `alias`/`versionId` in inference body, resolve to config, and inject KB context.

- [ ] **Step 1: Update inference route to accept alias and resolve version**

In `apps/web-ui/app/api/v1/inference/route.ts`, after the `body` destructuring (around line 57), add alias/version resolution logic.

Replace lines 56-79 (the body/agent/version fetch block) with:

```typescript
    const body = await req.json();
    const { messages, sessionId, systemPrompt, temperature, maxTokens, stream = true, noCache = false, alias, versionId: requestedVersionId } = body;

    // Fetch agent
    const agent = await db.agent.findFirst({ where: { id: agentId, tenantId } });
    if (!agent || agent.status !== 'active') {
      return new Response(
        JSON.stringify({ error: { type: 'agent_not_found', message: 'Agent not found or inactive' } }),
        { status: 404 }
      );
    }

    // Resolve version: explicit versionId > alias > default alias > published version
    let version: { id: string; config: unknown; status: string } | null = null;

    if (requestedVersionId) {
      version = await db.agentVersion.findFirst({
        where: { id: requestedVersionId, agentId },
      }) as typeof version;
    }

    if (!version && alias) {
      const aliasService = new (await import('@chatbot/agent-studio')).AgentAliasService(tenantId, db as any);
      try {
        const resolved = await aliasService.resolveAlias(agentId, alias);
        version = { id: resolved.versionId, config: resolved.config, status: 'published' };
      } catch {
        // alias not found — fall through
      }
    }

    if (!version) {
      // Try default alias
      const defaultAlias = await db.agentAlias.findFirst({
        where: { agentId, isDefault: true },
        include: { version: true },
      });
      if (defaultAlias) {
        version = defaultAlias.version as typeof version;
      }
    }

    if (!version) {
      // Fallback: latest published
      version = await db.agentVersion.findFirst({
        where: { agentId, status: 'published' },
        orderBy: { version: 'desc' },
      }) as typeof version;
    }

    if (!version) {
      return new Response(
        JSON.stringify({ error: { type: 'agent_not_found', message: 'No published version found for this agent' } }),
        { status: 404 }
      );
    }
```

Also add the import at the top of the file:
```typescript
import { AgentAliasService } from '@chatbot/agent-studio';
```

- [ ] **Step 2: Add KB retrieval helper**

At the bottom of `apps/web-ui/app/api/v1/inference/route.ts`, before the catch block, add a helper function (or create it as a local function above the POST handler):

```typescript
async function buildKbContext(
  agentId: string,
  tenantId: string,
  query: string,
  db: any
): Promise<string> {
  const attachments = await db.agentKnowledgeBase.findMany({
    where: { agentId },
    include: { knowledgeBase: true },
  });

  if (!attachments || attachments.length === 0) return '';

  const { RetrievalService } = await import('@chatbot/knowledge-base');
  const retrieval = new RetrievalService(tenantId);

  const contexts: string[] = [];
  for (const att of attachments) {
    const kb = att.knowledgeBase;
    if (kb.status !== 'active') continue;

    try {
      const results = await retrieval.query(query, {
        knowledgeBaseId: kb.id,
        topK: 5,
      });

      if (results.length > 0) {
        contexts.push(`--- From ${kb.name} ---\n${results.map((r) => r.content).join('\n\n')}`);
      }
    } catch {
      // Skip KBs that fail retrieval
    }
  }

  return contexts.join('\n\n');
}
```

- [ ] **Step 3: Inject KB context into simple agent execution**

In the simple agent execution block (around line 161), modify the system prompt:

Find the line:
```typescript
const effectiveSystem = systemPrompt ?? simpleConfig.systemPrompt ?? 'You are a helpful assistant.';
```

Replace with:
```typescript
    const userQuery = coreMessages.filter((m) => m.role === 'user').pop()?.content ?? '';
    const kbContext = await buildKbContext(agentId, tenantId, userQuery, db);

    let effectiveSystem = systemPrompt ?? simpleConfig.systemPrompt ?? 'You are a helpful assistant.';
    if (kbContext) {
      effectiveSystem = `${effectiveSystem}\n\nUse the following retrieved context to answer questions. If the context does not contain the answer, say so.\n\n${kbContext}`;
    }
```

- [ ] **Step 4: Update playground route similarly**

In `apps/web-ui/app/api/agents/[id]/playground/route.ts`, after line 34 (`const { messages, systemPrompt, model, temperature, agentVersionId } = body;`), add:

```typescript
    const { alias } = body;

    // Resolve version
    let resolvedConfig: Record<string, unknown> = {};
    let resolvedVersionId: string | null = agentVersionId ?? null;

    if (resolvedVersionId) {
      const version = await db.agentVersion.findFirst({ where: { id: resolvedVersionId, agentId: id } });
      if (version) {
        resolvedConfig = (version.config as Record<string, unknown>) ?? {};
      }
    } else if (alias) {
      const aliasService = new (await import('@chatbot/agent-studio')).AgentAliasService(tenantId, db as any);
      try {
        const resolved = await aliasService.resolveAlias(id, alias);
        resolvedConfig = resolved.config;
        resolvedVersionId = resolved.versionId;
      } catch {
        // fall through to agent config
      }
    } else {
      // Try default alias
      const defaultAlias = await db.agentAlias.findFirst({
        where: { agentId: id, isDefault: true },
        include: { version: true },
      });
      if (defaultAlias) {
        resolvedConfig = (defaultAlias.version.config as Record<string, unknown>) ?? {};
        resolvedVersionId = defaultAlias.versionId;
      }
    }

    if (Object.keys(resolvedConfig).length === 0) {
      resolvedConfig = (agent.config as Record<string, unknown>) ?? {};
    }
```

Then replace the existing `config` variable usage in the route with `resolvedConfig`.

Also add the same `buildKbContext` helper function at the bottom of the file, and inject it into the system prompt the same way as in the inference route.

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/app/api/v1/inference/route.ts apps/web-ui/app/api/agents/[id]/playground/route.ts
git commit -m "feat(api): resolve alias/version in inference + inject KB context

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Frontend React Query Hooks

**Files:**
- Create: `apps/web-ui/hooks/use-agent-knowledge-bases.ts`
- Create: `apps/web-ui/hooks/use-agent-aliases.ts`
- Modify: `apps/web-ui/hooks/use-agent-versions.ts`

**Goal:** Data fetching hooks for the new tabs.

- [ ] **Step 1: KB attachment hooks**

`apps/web-ui/hooks/use-agent-knowledge-bases.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface AttachedKnowledgeBase {
  id: string;
  knowledgeBaseId: string;
  knowledgeBase: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    documentCount: number;
    chunkCount: number;
  };
}

async function fetchAttachedKBs(agentId: string): Promise<AttachedKnowledgeBase[]> {
  const res = await fetch(`/api/agents/${agentId}/knowledge-bases`);
  if (!res.ok) throw new Error('Failed to fetch attached knowledge bases');
  return res.json();
}

async function attachKB(agentId: string, knowledgeBaseId: string): Promise<AttachedKnowledgeBase> {
  const res = await fetch(`/api/agents/${agentId}/knowledge-bases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ knowledgeBaseId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to attach knowledge base');
  }
  return res.json();
}

async function detachKB(agentId: string, kbId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/knowledge-bases/${kbId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to detach knowledge base');
}

export const agentKbKeys = {
  all: (agentId: string) => ['agents', agentId, 'knowledge-bases'] as const,
};

export function useAgentKnowledgeBases(agentId: string) {
  return useQuery({
    queryKey: agentKbKeys.all(agentId),
    queryFn: () => fetchAttachedKBs(agentId),
    enabled: Boolean(agentId),
  });
}

export function useAttachKnowledgeBase(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (knowledgeBaseId: string) => attachKB(agentId, knowledgeBaseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKbKeys.all(agentId) });
    },
  });
}

export function useDetachKnowledgeBase(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kbId: string) => detachKB(agentId, kbId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKbKeys.all(agentId) });
    },
  });
}
```

- [ ] **Step 2: Alias hooks**

`apps/web-ui/hooks/use-agent-aliases.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface AgentAlias {
  id: string;
  name: string;
  versionId: string;
  isDefault: boolean;
  version: { version: number; status: string };
}

async function fetchAliases(agentId: string): Promise<AgentAlias[]> {
  const res = await fetch(`/api/agents/${agentId}/aliases`);
  if (!res.ok) throw new Error('Failed to fetch aliases');
  return res.json();
}

async function createAlias(agentId: string, input: { name: string; versionId: string; isDefault?: boolean }): Promise<AgentAlias> {
  const res = await fetch(`/api/agents/${agentId}/aliases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to create alias');
  }
  return res.json();
}

async function updateAlias(agentId: string, aliasId: string, input: { versionId?: string; isDefault?: boolean }): Promise<AgentAlias> {
  const res = await fetch(`/api/agents/${agentId}/aliases/${aliasId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Failed to update alias');
  return res.json();
}

async function deleteAlias(agentId: string, aliasId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/aliases/${aliasId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete alias');
}

export const aliasKeys = {
  all: (agentId: string) => ['agents', agentId, 'aliases'] as const,
};

export function useAgentAliases(agentId: string) {
  return useQuery({
    queryKey: aliasKeys.all(agentId),
    queryFn: () => fetchAliases(agentId),
    enabled: Boolean(agentId),
  });
}

export function useCreateAlias(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; versionId: string; isDefault?: boolean }) => createAlias(agentId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aliasKeys.all(agentId) });
      queryClient.invalidateQueries({ queryKey: ['agents', agentId, 'versions'] });
    },
  });
}

export function useUpdateAlias(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ aliasId, input }: { aliasId: string; input: { versionId?: string; isDefault?: boolean } }) =>
      updateAlias(agentId, aliasId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aliasKeys.all(agentId) });
      queryClient.invalidateQueries({ queryKey: ['agents', agentId, 'versions'] });
    },
  });
}

export function useDeleteAlias(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (aliasId: string) => deleteAlias(agentId, aliasId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aliasKeys.all(agentId) });
    },
  });
}
```

- [ ] **Step 3: Extend version hooks with publish**

`apps/web-ui/hooks/use-agent-versions.ts` — current file exists. Replace its entire contents with:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface AgentVersion {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  aliases?: Array<{ id: string; name: string; isDefault: boolean }>;
}

async function fetchVersions(agentId: string): Promise<AgentVersion[]> {
  const res = await fetch(`/api/agents/${agentId}/versions`);
  if (!res.ok) throw new Error('Failed to fetch versions');
  return res.json();
}

async function publishVersion(agentId: string, versionId: string): Promise<AgentVersion> {
  const res = await fetch(`/api/agents/${agentId}/versions/${versionId}/publish`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to publish version');
  return res.json();
}

export const versionKeys = {
  all: (agentId: string) => ['agents', agentId, 'versions'] as const,
};

export function useAgentVersions(agentId: string) {
  return useQuery({
    queryKey: versionKeys.all(agentId),
    queryFn: () => fetchVersions(agentId),
    enabled: Boolean(agentId),
  });
}

export function usePublishAgent(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => publishVersion(agentId, versionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: versionKeys.all(agentId) });
    },
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/hooks/
git commit -m "feat(ui): add hooks for KB attachments, aliases, and version publishing

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Frontend Tab Components

**Files:**
- Create: `apps/web-ui/components/agents/tabs/knowledge-bases-tab.tsx`
- Create: `apps/web-ui/components/agents/tabs/versions-tab.tsx`
- Create: `apps/web-ui/components/agents/tabs/alias-manager.tsx`
- Create: `apps/web-ui/components/agents/playground/version-selector.tsx`

**Goal:** Replace "coming soon" placeholders with working tabs.

- [ ] **Step 1: Knowledge Bases Tab**

`apps/web-ui/components/agents/tabs/knowledge-bases-tab.tsx`:

```typescript
'use client';

import { useAgentKnowledgeBases, useAttachKnowledgeBase, useDetachKnowledgeBase } from '@/hooks/use-agent-knowledge-bases';
import { useKnowledgeBases } from '@/hooks/use-knowledge-bases';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { BookOpen, Link2, Unlink } from 'lucide-react';

export function KnowledgeBasesTab({ agentId }: { agentId: string }) {
  const { data: attached, isLoading: attachedLoading } = useAgentKnowledgeBases(agentId);
  const { data: allKBs, isLoading: allLoading } = useKnowledgeBases();
  const attach = useAttachKnowledgeBase(agentId);
  const detach = useDetachKnowledgeBase(agentId);

  const attachedIds = new Set((attached ?? []).map((a) => a.knowledgeBaseId));

  if (attachedLoading || allLoading) {
    return (
      <Card>
        <CardContent className="py-8 space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Knowledge Bases</CardTitle>
        <CardDescription>Attach knowledge bases to provide context for this agent.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {allKBs?.items.length === 0 && (
          <p className="text-muted-foreground text-sm">No knowledge bases available. Create one first.</p>
        )}
        {allKBs?.items.map((kb) => {
          const isAttached = attachedIds.has(kb.id);
          return (
            <div key={kb.id} className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <BookOpen className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium text-sm">{kb.name}</p>
                  <p className="text-xs text-muted-foreground">{kb.documentCount} documents · {kb.chunkCount} chunks</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={kb.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">{kb.status}</Badge>
                {isAttached ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => detach.mutateAsync(kb.id).then(() => toast.success('Detached')).catch(() => toast.error('Failed'))}
                    disabled={detach.isPending}
                  >
                    <Unlink className="h-3 w-3 mr-1" />
                    Detach
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => attach.mutateAsync(kb.id).then(() => toast.success('Attached')).catch(() => toast.error('Failed'))}
                    disabled={attach.isPending}
                  >
                    <Link2 className="h-3 w-3 mr-1" />
                    Attach
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

Note: `useKnowledgeBases` hook should already exist. If it does not, check `apps/web-ui/hooks/` and create a minimal one based on the knowledge-bases API.

- [ ] **Step 2: Versions Tab**

`apps/web-ui/components/agents/tabs/versions-tab.tsx`:

```typescript
'use client';

import { useAgentVersions, usePublishAgent } from '@/hooks/use-agent-versions';
import { useAgentAliases } from '@/hooks/use-agent-aliases';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Play, CheckCircle } from 'lucide-react';
import Link from 'next/link';

export function VersionsTab({ agentId }: { agentId: string }) {
  const { data: versions, isLoading } = useAgentVersions(agentId);
  const { data: aliases } = useAgentAliases(agentId);
  const publish = usePublishAgent(agentId);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Versions</CardTitle>
        <CardDescription>View version history, publish versions, and test in playground.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {versions?.length === 0 && (
          <p className="text-muted-foreground text-sm">No versions yet. Save the agent to create one.</p>
        )}
        {versions?.map((v) => {
          const versionAliases = aliases?.filter((a) => a.versionId === v.id) ?? [];
          return (
            <div key={v.id} className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                  {v.version}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">Version {v.version}</p>
                    <Badge variant={v.status === 'published' ? 'default' : v.status === 'draft' ? 'secondary' : 'outline'} className="text-[10px]">
                      {v.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {versionAliases.length > 0
                      ? `Aliases: ${versionAliases.map((a) => `${a.name}${a.isDefault ? ' (default)' : ''}`).join(', ')}`
                      : 'No aliases'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={`/agents/${agentId}/playground?version=${v.id}`} />}
                >
                  <Play className="h-3 w-3 mr-1" />
                  Test
                </Button>
                {v.status === 'draft' && (
                  <Button
                    size="sm"
                    onClick={() => publish.mutateAsync(v.id).then(() => toast.success('Published')).catch(() => toast.error('Failed'))}
                    disabled={publish.isPending}
                  >
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Publish
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Alias Manager**

`apps/web-ui/components/agents/tabs/alias-manager.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useAgentAliases, useCreateAlias, useUpdateAlias, useDeleteAlias } from '@/hooks/use-agent-aliases';
import { useAgentVersions } from '@/hooks/use-agent-versions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus } from 'lucide-react';

export function AliasManager({ agentId }: { agentId: string }) {
  const { data: aliases } = useAgentAliases(agentId);
  const { data: versions } = useAgentVersions(agentId);
  const create = useCreateAlias(agentId);
  const update = useUpdateAlias(agentId);
  const remove = useDeleteAlias(agentId);

  const [name, setName] = useState('');
  const [versionId, setVersionId] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [open, setOpen] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !versionId) {
      toast.error('Name and version are required');
      return;
    }
    try {
      await create.mutateAsync({ name: name.trim(), versionId, isDefault });
      toast.success('Alias created');
      setName('');
      setVersionId('');
      setIsDefault(false);
      setOpen(false);
    } catch {
      toast.error('Failed to create alias');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Aliases</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="h-3 w-3 mr-1" />
              New Alias
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Alias</DialogTitle>
              <DialogDescription>Map a name like "dev" or "prod" to a specific version.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid gap-1.5">
                <Label htmlFor="alias-name">Name</Label>
                <Input id="alias-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. dev" />
              </div>
              <div className="grid gap-1.5">
                <Label>Version</Label>
                <Select value={versionId} onValueChange={setVersionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select version" />
                  </SelectTrigger>
                  <SelectContent>
                    {versions?.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        Version {v.version} ({v.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="alias-default" checked={isDefault} onCheckedChange={setIsDefault} />
                <Label htmlFor="alias-default">Set as default alias</Label>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={create.isPending}>
                {create.isPending ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {aliases?.length === 0 && (
        <p className="text-muted-foreground text-sm">No aliases configured.</p>
      )}

      {aliases?.map((alias) => (
        <div key={alias.id} className="flex items-center justify-between p-3 border rounded-lg">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{alias.name}</span>
            {alias.isDefault && <Badge variant="default" className="text-[10px]">default</Badge>}
            <span className="text-xs text-muted-foreground">→ Version {alias.version.version}</span>
          </div>
          <div className="flex items-center gap-2">
            {!alias.isDefault && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => update.mutateAsync({ aliasId: alias.id, input: { isDefault: true } }).then(() => toast.success('Set as default')).catch(() => toast.error('Failed'))}
              >
                Set default
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-destructive"
              onClick={() => remove.mutateAsync(alias.id).then(() => toast.success('Deleted')).catch(() => toast.error('Failed'))}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Playground Version Selector**

`apps/web-ui/components/agents/playground/version-selector.tsx`:

```typescript
'use client';

import { useAgentAliases } from '@/hooks/use-agent-aliases';
import { useAgentVersions } from '@/hooks/use-agent-versions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function PlaygroundVersionSelector({
  agentId,
  value,
  onChange,
}: {
  agentId: string;
  value: string;
  onChange: (val: string) => void;
}) {
  const { data: aliases } = useAgentAliases(agentId);
  const { data: versions } = useAgentVersions(agentId);

  const options: Array<{ label: string; value: string; group: string }> = [
    { label: 'Latest draft (agent config)', value: '', group: 'Default' },
  ];

  aliases?.forEach((a) => {
    options.push({
      label: `${a.name}${a.isDefault ? ' (default)' : ''} → v${a.version.version}`,
      value: `alias:${a.name}`,
      group: 'Aliases',
    });
  });

  versions?.forEach((v) => {
    options.push({
      label: `Version ${v.version} (${v.status})`,
      value: `version:${v.id}`,
      group: 'Versions',
    });
  });

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[240px]">
        <SelectValue placeholder="Select version or alias" />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/components/agents/
git commit -m "feat(ui): add KnowledgeBasesTab, VersionsTab, AliasManager, PlaygroundVersionSelector

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Wire Tabs into Agent Detail Page

**Files:**
- Modify: `apps/web-ui/app/(dashboard)/agents/[id]/page.tsx`

**Goal:** Replace "coming soon" placeholders with actual components.

- [ ] **Step 1: Update imports**

At the top of `apps/web-ui/app/(dashboard)/agents/[id]/page.tsx`, add:

```typescript
import { KnowledgeBasesTab } from '@/components/agents/tabs/knowledge-bases-tab';
import { VersionsTab } from '@/components/agents/tabs/versions-tab';
import { AliasManager } from '@/components/agents/tabs/alias-manager';
```

- [ ] **Step 2: Replace Knowledge Bases tab content**

Find the block:
```tsx
        <TabsContent value="knowledge-bases">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Knowledge base integration coming soon.
            </CardContent>
          </Card>
        </TabsContent>
```

Replace with:
```tsx
        <TabsContent value="knowledge-bases">
          <KnowledgeBasesTab agentId={agentId} />
        </TabsContent>
```

- [ ] **Step 3: Replace Versions tab content**

Find the block:
```tsx
        <TabsContent value="versions">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Version history coming soon.
            </CardContent>
          </Card>
        </TabsContent>
```

Replace with:
```tsx
        <TabsContent value="versions">
          <VersionsTab agentId={agentId} />
          <div className="mt-4">
            <AliasManager agentId={agentId} />
          </div>
        </TabsContent>
```

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/app/(dashboard)/agents/[id]/page.tsx
git commit -m "feat(ui): wire KnowledgeBasesTab, VersionsTab, and AliasManager into agent detail

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: Wire Version Selector into Playground

**Files:**
- Modify: `apps/web-ui/app/(dashboard)/agents/[id]/playground/page.tsx`
- Modify: `apps/web-ui/app/(dashboard)/agents/playground/page.tsx` (global playground if it exists)

**Goal:** Allow selecting an alias or version before running inference in playground.

- [ ] **Step 1: Read existing playground page**

Check the content of `apps/web-ui/app/(dashboard)/agents/[id]/playground/page.tsx` and `apps/web-ui/app/(dashboard)/agents/playground/page.tsx` first. If they already exist, read them.

- [ ] **Step 2: Add version selector to playground**

If the playground page uses a form/hook to call the playground API, add a `PlaygroundVersionSelector` above the chat input area. Pass the selected value into the API call body under `alias` or `agentVersionId`.

For the agent-specific playground (`agents/[id]/playground/page.tsx`), wrap the existing chat component with a version selector:

```typescript
'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { PlaygroundVersionSelector } from '@/components/agents/playground/version-selector';
// ...existing imports

export default function AgentPlaygroundPage() {
  const params = useParams<{ id: string }>();
  const agentId = params.id;
  const [versionValue, setVersionValue] = useState('');

  const getBody = () => {
    if (versionValue.startsWith('alias:')) {
      return { alias: versionValue.replace('alias:', '') };
    }
    if (versionValue.startsWith('version:')) {
      return { agentVersionId: versionValue.replace('version:', '') };
    }
    return {};
  };

  // Pass getBody() result into your existing chat submission
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 border-b">
        <PlaygroundVersionSelector agentId={agentId} value={versionValue} onChange={setVersionValue} />
      </div>
      {/* existing chat component */}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/app/(dashboard)/agents/playground/
git commit -m "feat(ui): add version/alias selector to playground

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: Run Tests + Build Verification

**Files:**
- All modified files

- [ ] **Step 1: Run unit tests**

```bash
bun run test
```
Expected: All tests pass. If failures exist, fix them before proceeding.

- [ ] **Step 2: Type check**

```bash
bunx tsc --noEmit
```
Expected: No type errors.

- [ ] **Step 3: Build web-ui**

```bash
nx build web-ui
```
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git commit -m "test+build: verify agent studio integration passes tests and builds

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Plan Self-Review

| Check | Status |
|-------|--------|
| **Spec coverage** | Pass — all spec sections (schema, KB attachment, versions, aliases, inference, UI) have dedicated tasks |
| **Placeholder scan** | Pass — no TBD, TODO, or "implement later" |
| **Type consistency** | Pass — `AgentAlias`, `AgentKnowledgeBase`, `AliasManager`, `PlaygroundVersionSelector` use consistent naming |
| **Exact file paths** | Pass — every create/modify step lists exact paths |
| **Test coverage** | Pass — service tests in Tasks 2-3, build verification in Task 12 |
| **No skipped steps** | Pass — every task has code, command, and commit step |
