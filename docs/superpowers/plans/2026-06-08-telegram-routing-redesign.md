# Telegram Routing Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate Telegram routing-rules layer (`TelegramRouting`/`TelegramRoutingRule`/`KeywordRouter` + settings page) with a direct bot↔agent binding chosen from a dropdown on the `telegram_trigger` node and synced to the database automatically when the agent is saved.

**Architecture:** Add a nullable `agentId`/`triggerNodeId` FK pair directly on `TelegramAccount`. A new `TelegramAccountBindingService` scans a saved agent's graph for `telegram_trigger` nodes with a chosen `accountId`, validates the 1:1 invariant, and writes the binding — all inside the same DB transaction as the agent save. The webhook processor then reads `account.agentId` directly instead of resolving a routing strategy.

**Tech Stack:** Next.js 15 App Router, Prisma 6 + PostgreSQL, TypeScript strict, Zod, TanStack Query/Form, shadcn/ui, Pino logger, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-08-telegram-routing-redesign-design.md`

---

## Task 1: Schema migration — direct binding on `TelegramAccount`, drop routing tables

**Files:**
- Modify: `prisma/schema.prisma:229-257` (Agent model), `prisma/schema.prisma:815-862` (TelegramAccount/TelegramRouting/TelegramRoutingRule)

- [ ] **Step 1: Add the `telegramAccounts` back-relation to `Agent`**

In `prisma/schema.prisma`, inside the `model Agent { ... }` relations block (around line 250, right after `sdkWidgets SdkWidget[]`), add:

```prisma
  sdkWidgets         SdkWidget[]
  telegramAccounts   TelegramAccount[]
```

- [ ] **Step 2: Replace the `TelegramAccount` model and delete the routing models**

Replace the entire block from `model TelegramAccount {` through the closing `}` of `model TelegramRoutingRule` (lines 815-862) with:

```prisma
model TelegramAccount {
  id            String   @id @default(cuid())
  tenantId      String
  botToken      String
  botName       String?
  botUsername   String?
  webhookSecret String
  status        String   @default("active")
  agentId       String?
  triggerNodeId String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  tenant   Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  agent    Agent?            @relation(fields: [agentId], references: [id], onDelete: SetNull)
  sessions TelegramSession[]
  messages TelegramMessage[]

  @@index([tenantId])
  @@index([agentId])
  @@map("telegram_accounts")
}
```

This removes `TelegramRouting` and `TelegramRoutingRule` entirely and replaces the `routingConfig TelegramRouting?` relation with the direct `agentId`/`triggerNodeId` columns + `agent` relation.

- [ ] **Step 3: Generate and apply the migration**

Run:
```bash
bunx prisma migrate dev --name telegram_direct_agent_binding --schema=./prisma/schema.prisma
```
Expected: Prisma reports it will drop `telegram_routing` and `telegram_routing_rules`, and add `agent_id`/`trigger_node_id` columns + FK + index to `telegram_accounts`. Confirm the prompt (this is local dev with no routing data worth preserving — confirmed with the user during brainstorming).

- [ ] **Step 4: Regenerate the Prisma client**

Run:
```bash
bunx prisma generate --schema=./prisma/schema.prisma
```
Expected: "Generated Prisma Client" with no errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "$(cat <<'EOF'
feat(db): add direct agent binding to TelegramAccount, drop routing tables

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `TelegramAccountBindingService` — failing test first

**Files:**
- Create: `libs/shared/src/services/telegram-account-binding-service.test.ts`

- [ ] **Step 1: Write the failing test suite**

Create `libs/shared/src/services/telegram-account-binding-service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TelegramAccountBindingService,
  TelegramAccountBindingError,
  type TelegramAccountBindingDb,
} from './telegram-account-binding-service';

const mockTelegramAccount = {
  findFirst: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
};

const mockDb: TelegramAccountBindingDb = { telegramAccount: mockTelegramAccount };

const TENANT = 'tenant-1';
const AGENT = 'agent-1';

const triggerNode = (id: string, accountId?: string) => ({
  id,
  type: 'telegram_trigger',
  config: accountId ? { type: 'telegram_trigger', accountId } : { type: 'telegram_trigger' },
});

describe('TelegramAccountBindingService', () => {
  let service: TelegramAccountBindingService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTelegramAccount.update.mockResolvedValue({});
    mockTelegramAccount.updateMany.mockResolvedValue({ count: 0 });
    service = new TelegramAccountBindingService(mockDb);
  });

  it('does nothing but clear stale bindings when no trigger has an accountId', async () => {
    await service.sync({ tenantId: TENANT, agentId: AGENT, nodes: [triggerNode('n1')] });

    expect(mockTelegramAccount.findFirst).not.toHaveBeenCalled();
    expect(mockTelegramAccount.update).not.toHaveBeenCalled();
    expect(mockTelegramAccount.updateMany).toHaveBeenCalledWith({
      where: { agentId: AGENT },
      data: { agentId: null, triggerNodeId: null },
    });
  });

  it('binds an unbound account to this agent and clears other stale bindings', async () => {
    mockTelegramAccount.findFirst.mockResolvedValue({
      id: 'acct-1',
      tenantId: TENANT,
      agentId: null,
      triggerNodeId: null,
      agent: null,
    });

    await service.sync({ tenantId: TENANT, agentId: AGENT, nodes: [triggerNode('n1', 'acct-1')] });

    expect(mockTelegramAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 'acct-1', tenantId: TENANT },
      include: { agent: { select: { name: true } } },
    });
    expect(mockTelegramAccount.update).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: { agentId: AGENT, triggerNodeId: 'n1' },
    });
    expect(mockTelegramAccount.updateMany).toHaveBeenCalledWith({
      where: { agentId: AGENT, id: { not: 'acct-1' } },
      data: { agentId: null, triggerNodeId: null },
    });
  });

  it('is idempotent when the account is already bound to this agent', async () => {
    mockTelegramAccount.findFirst.mockResolvedValue({
      id: 'acct-1',
      tenantId: TENANT,
      agentId: AGENT,
      triggerNodeId: 'old-node',
      agent: { name: 'My Agent' },
    });

    await service.sync({ tenantId: TENANT, agentId: AGENT, nodes: [triggerNode('n1', 'acct-1')] });

    expect(mockTelegramAccount.update).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: { agentId: AGENT, triggerNodeId: 'n1' },
    });
  });

  it('rejects binding to an account already bound to a different agent', async () => {
    mockTelegramAccount.findFirst.mockResolvedValue({
      id: 'acct-1',
      tenantId: TENANT,
      agentId: 'other-agent',
      triggerNodeId: 'n9',
      agent: { name: 'Support Bot' },
    });

    await expect(
      service.sync({ tenantId: TENANT, agentId: AGENT, nodes: [triggerNode('n1', 'acct-1')] }),
    ).rejects.toMatchObject({
      name: 'TelegramAccountBindingError',
      code: 'ALREADY_BOUND',
      message: 'This bot is already connected to "Support Bot"',
    });

    expect(mockTelegramAccount.update).not.toHaveBeenCalled();
  });

  it('rejects when more than one trigger node has an accountId', async () => {
    await expect(
      service.sync({
        tenantId: TENANT,
        agentId: AGENT,
        nodes: [triggerNode('n1', 'acct-1'), triggerNode('n2', 'acct-2')],
      }),
    ).rejects.toMatchObject({
      name: 'TelegramAccountBindingError',
      code: 'MULTIPLE_TRIGGERS',
    });

    expect(mockTelegramAccount.findFirst).not.toHaveBeenCalled();
  });

  it('rejects when the selected account does not exist for this tenant', async () => {
    mockTelegramAccount.findFirst.mockResolvedValue(null);

    await expect(
      service.sync({ tenantId: TENANT, agentId: AGENT, nodes: [triggerNode('n1', 'acct-missing')] }),
    ).rejects.toMatchObject({
      name: 'TelegramAccountBindingError',
      code: 'ACCOUNT_NOT_FOUND',
    });
  });

  it('throws TelegramAccountBindingError instances that pass instanceof checks', async () => {
    mockTelegramAccount.findFirst.mockResolvedValue(null);

    try {
      await service.sync({ tenantId: TENANT, agentId: AGENT, nodes: [triggerNode('n1', 'acct-missing')] });
      expect.unreachable('expected sync to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(TelegramAccountBindingError);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run libs/shared/src/services/telegram-account-binding-service.test.ts`
Expected: FAIL — `Cannot find module './telegram-account-binding-service'`

- [ ] **Step 3: Commit the failing test**

```bash
git add libs/shared/src/services/telegram-account-binding-service.test.ts
git commit -m "$(cat <<'EOF'
test(shared): add failing spec for TelegramAccountBindingService

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Implement `TelegramAccountBindingService`

**Files:**
- Create: `libs/shared/src/services/telegram-account-binding-service.ts`
- Modify: `libs/shared/src/index.ts`

- [ ] **Step 1: Write the implementation**

Create `libs/shared/src/services/telegram-account-binding-service.ts`:

```typescript
import { createLogger } from '../logging/logger';

const logger = createLogger('telegram-account-binding-service');

export type TelegramAccountBindingErrorCode = 'MULTIPLE_TRIGGERS' | 'ACCOUNT_NOT_FOUND' | 'ALREADY_BOUND';

export class TelegramAccountBindingError extends Error {
  readonly code: TelegramAccountBindingErrorCode;

  constructor(message: string, code: TelegramAccountBindingErrorCode) {
    super(message);
    this.name = 'TelegramAccountBindingError';
    this.code = code;
  }
}

interface TelegramAccountBindingRow {
  id: string;
  tenantId: string;
  agentId: string | null;
  triggerNodeId: string | null;
  agent: { name: string } | null;
}

export interface TelegramAccountBindingDb {
  telegramAccount: {
    findFirst(args: {
      where: { id: string; tenantId: string };
      include: { agent: { select: { name: true } } };
    }): Promise<TelegramAccountBindingRow | null>;
    update(args: {
      where: { id: string };
      data: { agentId: string | null; triggerNodeId: string | null };
    }): Promise<unknown>;
    updateMany(args: {
      where: { agentId: string; id?: { not: string } };
      data: { agentId: null; triggerNodeId: null };
    }): Promise<{ count: number }>;
  };
}

interface GraphNodeLike {
  id: string;
  type: string;
  config?: { accountId?: unknown } | null;
}

export interface SyncTelegramAccountBindingInput {
  tenantId: string;
  agentId: string;
  nodes: GraphNodeLike[];
}

function extractAccountId(node: GraphNodeLike): string | undefined {
  const accountId = node.config?.accountId;
  return typeof accountId === 'string' && accountId.length > 0 ? accountId : undefined;
}

export class TelegramAccountBindingService {
  constructor(private readonly db: TelegramAccountBindingDb) {}

  async sync(input: SyncTelegramAccountBindingInput): Promise<void> {
    const { tenantId, agentId, nodes } = input;

    try {
      const boundTriggers = nodes
        .filter((n) => n.type === 'telegram_trigger')
        .map((n) => ({ nodeId: n.id, accountId: extractAccountId(n) }))
        .filter((t): t is { nodeId: string; accountId: string } => Boolean(t.accountId));

      if (boundTriggers.length > 1) {
        throw new TelegramAccountBindingError(
          'Only one Telegram Trigger can be bound to an account per agent',
          'MULTIPLE_TRIGGERS',
        );
      }

      const chosen = boundTriggers[0];

      if (chosen) {
        const account = await this.db.telegramAccount.findFirst({
          where: { id: chosen.accountId, tenantId },
          include: { agent: { select: { name: true } } },
        });

        if (!account) {
          throw new TelegramAccountBindingError('Selected Telegram account was not found', 'ACCOUNT_NOT_FOUND');
        }

        if (account.agentId && account.agentId !== agentId) {
          throw new TelegramAccountBindingError(
            `This bot is already connected to "${account.agent?.name ?? 'another agent'}"`,
            'ALREADY_BOUND',
          );
        }

        await this.db.telegramAccount.update({
          where: { id: account.id },
          data: { agentId, triggerNodeId: chosen.nodeId },
        });
      }

      await this.db.telegramAccount.updateMany({
        where: {
          agentId,
          ...(chosen ? { id: { not: chosen.accountId } } : {}),
        },
        data: { agentId: null, triggerNodeId: null },
      });

      logger.info(
        { tenantId, agentId, accountId: chosen?.accountId ?? null },
        'Telegram account binding synced',
      );
    } catch (error) {
      logger.error({ tenantId, agentId, error }, 'Failed to sync Telegram account binding');
      throw error;
    }
  }
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `bunx vitest run libs/shared/src/services/telegram-account-binding-service.test.ts`
Expected: PASS — 7 tests passing

- [ ] **Step 3: Export the service from the shared library**

In `libs/shared/src/index.ts`, find the line `export { PausedExecutionService } from './services/paused-execution-service';` (around line 46) and add directly after it:

```typescript
export {
  TelegramAccountBindingService,
  TelegramAccountBindingError,
} from './services/telegram-account-binding-service';
export type {
  TelegramAccountBindingDb,
  TelegramAccountBindingErrorCode,
  SyncTelegramAccountBindingInput,
} from './services/telegram-account-binding-service';
```

- [ ] **Step 4: Commit**

```bash
git add libs/shared/src/services/telegram-account-binding-service.ts libs/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): add TelegramAccountBindingService for graph-driven bot binding

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire the binding sync into the agent save route

**Files:**
- Modify: `apps/web-ui/app/api/agents/[id]/route.ts:1-73`

- [ ] **Step 1: Update imports and the `PUT` handler**

In `apps/web-ui/app/api/agents/[id]/route.ts`, replace the import block (lines 1-4):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, updateAgentSchema, createLogger } from '@chatbot/shared';
import { AgentService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';
```

with:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  getPrismaClient,
  updateAgentSchema,
  createLogger,
  TelegramAccountBindingService,
  TelegramAccountBindingError,
  type TelegramAccountBindingDb,
} from '@chatbot/shared';
import { AgentService, type AgentDb } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';
```

- [ ] **Step 2: Replace the `PUT` handler body to run inside a transaction**

Replace the entire `export async function PUT(...)` function (lines 38-73) with:

```typescript
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const parsed = updateAgentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }
    const validatedBody = parsed.data;
    const db = getPrismaClient();

    const agent = await db.$transaction(async (tx) => {
      const service = new AgentService(tenantId, tx as unknown as AgentDb);
      const updated = await service.update(id, validatedBody);

      if (validatedBody.config && typeof validatedBody.config === 'object') {
        const config = validatedBody.config as { nodes?: Array<{ id: string; type: string; config?: Record<string, unknown> }> };
        const bindingService = new TelegramAccountBindingService(tx as unknown as TelegramAccountBindingDb);
        await bindingService.sync({ tenantId, agentId: id, nodes: config.nodes ?? [] });
      }

      return updated;
    });

    logger.info({ tenantId, agentId: id }, 'Agent updated via API');
    return NextResponse.json(agent);
  } catch (error) {
    if (error instanceof TelegramAccountBindingError) {
      logger.warn({ error, code: error.code }, 'Agent save rejected by Telegram account binding sync');
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json(
        { error: 'Unauthorized', message: error.message },
        { status: 403 },
      );
    }
    logger.error({ error, agentId: (await params).id }, 'Failed to update agent');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Type-check the route**

Run: `bunx tsc --noEmit -p apps/web-ui/tsconfig.json`
Expected: no new errors referencing `route.ts` (pre-existing unrelated errors, if any, are out of scope)

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/app/api/agents/\[id\]/route.ts
git commit -m "$(cat <<'EOF'
feat(agents): sync Telegram account binding transactionally on agent save

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add `accountId` to the `telegram_trigger` node config

**Files:**
- Modify: `libs/agent-studio/src/types/nodes.ts:185-196`
- Modify: `libs/agent-studio/src/registry/schemas/telegram-trigger.ts`

- [ ] **Step 1: Add `accountId` to the TypeScript config type**

In `libs/agent-studio/src/types/nodes.ts`, replace the `TelegramTriggerNodeConfig` interface (lines 185-196):

```typescript
export interface TelegramTriggerNodeConfig {
  type: 'telegram_trigger';
  accountId?: string;
  channelMap?: {
    chatIdChannel?: string;
    textChannel?: string;
    messageTypeChannel?: string;
    mediaIdChannel?: string;
    callbackDataChannel?: string;
    fromNameChannel?: string;
    isGroupChannel?: string;
  };
}
```

- [ ] **Step 2: Add `accountId` to the Zod validation schema**

Replace the contents of `libs/agent-studio/src/registry/schemas/telegram-trigger.ts`:

```typescript
import { z } from 'zod';

export const telegramTriggerNodeSchema = z.object({
  type: z.literal('telegram_trigger'),
  accountId: z.string().optional(),
  channelMap: z.object({
    chatIdChannel: z.string().optional(),
    textChannel: z.string().optional(),
    messageTypeChannel: z.string().optional(),
    mediaIdChannel: z.string().optional(),
    callbackDataChannel: z.string().optional(),
    fromNameChannel: z.string().optional(),
    isGroupChannel: z.string().optional(),
  }).optional(),
});
```

- [ ] **Step 3: Type-check agent-studio**

Run: `bunx tsc --noEmit -p libs/agent-studio/tsconfig.json`
Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add libs/agent-studio/src/types/nodes.ts libs/agent-studio/src/registry/schemas/telegram-trigger.ts
git commit -m "$(cat <<'EOF'
feat(agent-studio): add accountId field to telegram_trigger node config

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Surface `agentId` on the Telegram accounts list API

**Files:**
- Modify: `apps/web-ui/app/api/telegram/accounts/route.ts`

- [ ] **Step 1: Add `agentId` to the `select`**

In `apps/web-ui/app/api/telegram/accounts/route.ts`, the `GET` handler currently selects:

```typescript
      select: {
        id: true,
        botName: true,
        botUsername: true,
        status: true,
        createdAt: true,
      },
```

Replace with:

```typescript
      select: {
        id: true,
        botName: true,
        botUsername: true,
        status: true,
        agentId: true,
        createdAt: true,
      },
```

This is the field the trigger-node dropdown uses to decide whether a bot is already bound (and to whom).

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/app/api/telegram/accounts/route.ts
git commit -m "$(cat <<'EOF'
feat(telegram): expose agentId on the accounts list endpoint

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `useTelegramAccounts` hook

**Files:**
- Create: `apps/web-ui/hooks/use-telegram-accounts.ts`

- [ ] **Step 1: Write the hook**

Modeled on the read-only list portion of `apps/web-ui/hooks/use-mcp-servers.ts`. Create `apps/web-ui/hooks/use-telegram-accounts.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';

export interface TelegramAccount {
  id: string;
  botName: string | null;
  botUsername: string | null;
  status: string;
  agentId: string | null;
  createdAt: string;
}

async function fetchTelegramAccounts(): Promise<TelegramAccount[]> {
  const res = await fetch('/api/telegram/accounts');
  if (!res.ok) throw new Error('Failed to fetch Telegram accounts');
  return res.json();
}

export const telegramAccountKeys = {
  all: ['telegram-accounts'] as const,
  lists: () => [...telegramAccountKeys.all, 'list'] as const,
};

export function useTelegramAccounts() {
  return useQuery({ queryKey: telegramAccountKeys.lists(), queryFn: fetchTelegramAccounts });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/hooks/use-telegram-accounts.ts
git commit -m "$(cat <<'EOF'
feat(web-ui): add useTelegramAccounts hook for the trigger-node bot picker

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Thread `agentId` from the canvas down to node-config forms

**Files:**
- Modify: `apps/web-ui/components/agents/config/config-panel.tsx:32-40`, `:124-126`
- Modify: `apps/web-ui/components/agents/canvas/agent-canvas.tsx:497-509`

The trigger-node dropdown needs to know which agent it's editing, so it can show "this bot is bound to *me*" instead of hiding it. `AgentCanvas` already receives `agentId` as a prop (line 59) — it just isn't passed down to `ConfigPanel` yet.

- [ ] **Step 1: Add `agentId` to `ConfigPanelProps` and pass it to the Telegram trigger form**

In `apps/web-ui/components/agents/config/config-panel.tsx`, replace the props interface (lines 32-38):

```typescript
interface ConfigPanelProps {
  node: GraphNode | null;
  allNodes: NodeOption[];
  agentId: string;
  onClose: () => void;
  onConfigChange: (nodeId: string, config: NodeConfig) => void;
  onDelete?: (nodeId: string) => void;
}
```

and the function signature (line 40):

```typescript
export function ConfigPanel({ node, allNodes, agentId, onClose, onConfigChange, onDelete }: ConfigPanelProps) {
```

Then update the Telegram trigger form invocation (lines 124-126):

```typescript
          {node.config.type === 'telegram_trigger' && (
            <TelegramTriggerNodeForm config={node.config} agentId={agentId} onChange={handleChange} />
          )}
```

- [ ] **Step 2: Pass `agentId` from `AgentCanvas`**

In `apps/web-ui/components/agents/canvas/agent-canvas.tsx`, in the `<ConfigPanel ... />` invocation (lines 497-509), add the `agentId` prop:

```typescript
        <ConfigPanel
          node={selectedNode}
          allNodes={rfNodes
            .filter((n) => n.id !== selectedNodeId)
            .map((n) => ({
              id: n.id,
              label: (n.data as { label: string }).label,
              type: n.type ?? 'unknown',
            }))}
          agentId={agentId}
          onClose={() => setSelectedNodeId(null)}
          onConfigChange={handleConfigChange}
          onDelete={handleDeleteNode}
        />
```

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit -p apps/web-ui/tsconfig.json`
Expected: no new errors (the next task makes `TelegramTriggerNodeForm` accept the new `agentId` prop — until then this will report a missing-prop error on the form, which Task 9 resolves)

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/components/agents/config/config-panel.tsx apps/web-ui/components/agents/canvas/agent-canvas.tsx
git commit -m "$(cat <<'EOF'
feat(web-ui): thread agentId from the canvas into node config forms

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Add the bot picker dropdown to `TelegramTriggerNodeForm`

**Files:**
- Modify: `apps/web-ui/components/agents/config/telegram-trigger-node-form.tsx`

- [ ] **Step 1: Rewrite the form to add the account dropdown**

Replace the full contents of `apps/web-ui/components/agents/config/telegram-trigger-node-form.tsx`:

```tsx
'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TelegramTriggerNodeConfig } from '@chatbot/agent-studio';
import { useTelegramAccounts } from '@/hooks/use-telegram-accounts';

const schema = z.object({
  accountId: z.string().optional(),
  chatIdChannel: z.string().optional(),
  textChannel: z.string().optional(),
  messageTypeChannel: z.string().optional(),
  mediaIdChannel: z.string().optional(),
  callbackDataChannel: z.string().optional(),
  fromNameChannel: z.string().optional(),
  isGroupChannel: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  config: TelegramTriggerNodeConfig;
  agentId: string;
  onChange: (config: TelegramTriggerNodeConfig) => void;
}

export function TelegramTriggerNodeForm({ config, agentId, onChange }: Props) {
  const map = config.channelMap ?? {};
  const { data: accounts, isLoading: accountsLoading } = useTelegramAccounts();

  const selectableAccounts = (accounts ?? []).filter(
    (a) => a.agentId === null || a.agentId === agentId,
  );

  const form = useForm({
    defaultValues: {
      accountId: config.accountId ?? '',
      chatIdChannel: map.chatIdChannel ?? '',
      textChannel: map.textChannel ?? '',
      messageTypeChannel: map.messageTypeChannel ?? '',
      mediaIdChannel: map.mediaIdChannel ?? '',
      callbackDataChannel: map.callbackDataChannel ?? '',
      fromNameChannel: map.fromNameChannel ?? '',
      isGroupChannel: map.isGroupChannel ?? '',
    } as FormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      const channelMap: TelegramTriggerNodeConfig['channelMap'] = {};
      if (value.chatIdChannel) channelMap.chatIdChannel = value.chatIdChannel;
      if (value.textChannel) channelMap.textChannel = value.textChannel;
      if (value.messageTypeChannel) channelMap.messageTypeChannel = value.messageTypeChannel;
      if (value.mediaIdChannel) channelMap.mediaIdChannel = value.mediaIdChannel;
      if (value.callbackDataChannel) channelMap.callbackDataChannel = value.callbackDataChannel;
      if (value.fromNameChannel) channelMap.fromNameChannel = value.fromNameChannel;
      if (value.isGroupChannel) channelMap.isGroupChannel = value.isGroupChannel;
      onChange({
        type: 'telegram_trigger',
        accountId: value.accountId || undefined,
        channelMap: Object.keys(channelMap).length ? channelMap : undefined,
      });
    },
  });

  const handleBlur = () => form.handleSubmit();

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-4">
      <form.Field name="accountId">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Connected Bot</Label>
            <Select
              value={field.state.value ?? ''}
              onValueChange={(v) => { field.handleChange(v); handleBlur(); }}
              disabled={accountsLoading}
            >
              <SelectTrigger id={field.name} aria-label="Connected Bot">
                <SelectValue placeholder={accountsLoading ? 'Loading...' : 'Select a connected bot'} />
              </SelectTrigger>
              <SelectContent>
                {selectableAccounts.length === 0 && !accountsLoading && (
                  <SelectItem value="__empty__" disabled>No available bots — connect one first</SelectItem>
                )}
                {selectableAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.botName ?? account.botUsername ?? account.id}
                    {account.botUsername && <span className="ml-1 text-xs text-muted-foreground">@{account.botUsername}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Bots already connected to other agents are hidden. Connect new bots from Settings → Channels → Telegram.
            </p>
          </div>
        )}
      </form.Field>

      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Available channels (auto-populated)</p>
        <p><code className="font-mono">tg_chat_id</code> — chat ID</p>
        <p><code className="font-mono">tg_text</code> — message text</p>
        <p><code className="font-mono">tg_message_type</code> — text / photo / etc.</p>
        <p><code className="font-mono">tg_media_id</code> — media file_id if media message</p>
        <p><code className="font-mono">tg_callback_data</code> — button callback data</p>
        <p><code className="font-mono">tg_from_name</code> — sender name</p>
        <p><code className="font-mono">tg_is_group</code> — true if group chat</p>
      </div>

      <p className="text-xs text-muted-foreground">Optionally remap channels to custom names. Leave blank to use defaults above.</p>

      {[
        { name: 'chatIdChannel' as const, label: 'Chat ID Channel', placeholder: 'tg_chat_id' },
        { name: 'textChannel' as const, label: 'Text Channel', placeholder: 'tg_text' },
        { name: 'messageTypeChannel' as const, label: 'Message Type Channel', placeholder: 'tg_message_type' },
        { name: 'mediaIdChannel' as const, label: 'Media ID Channel', placeholder: 'tg_media_id' },
        { name: 'callbackDataChannel' as const, label: 'Callback Data Channel', placeholder: 'tg_callback_data' },
        { name: 'fromNameChannel' as const, label: 'From Name Channel', placeholder: 'tg_from_name' },
        { name: 'isGroupChannel' as const, label: 'Is Group Channel', placeholder: 'tg_is_group' },
      ].map(({ name, label, placeholder }) => (
        <form.Field key={name} name={name}>
          {(field) => (
            <div className="grid gap-1.5">
              <Label htmlFor={field.name}>{label}</Label>
              <Input
                id={field.name}
                value={field.state.value ?? ''}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={() => { field.handleBlur(); handleBlur(); }}
                placeholder={placeholder}
              />
            </div>
          )}
        </form.Field>
      ))}
    </form>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit -p apps/web-ui/tsconfig.json`
Expected: no errors — the `agentId` prop mismatch from Task 8 is now resolved

- [ ] **Step 3: Manually verify in the browser**

Start the dev server (`bun run dev`), open an existing graph agent (or create one), add/select a Telegram Trigger node, and confirm:
- The "Connected Bot" dropdown loads and lists your connected bots
- Selecting a bot persists after clicking away and reopening the node
- A bot already bound to a *different* agent does not appear in the list

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/components/agents/config/telegram-trigger-node-form.tsx
git commit -m "$(cat <<'EOF'
feat(web-ui): add connected-bot picker to the Telegram Trigger node form

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Simplify `TelegramMessageProcessor` to read `account.agentId` directly

**Files:**
- Modify: `libs/telegram/src/processor/message-processor.ts:1-113`

- [ ] **Step 1: Remove the `createRouter` import**

In `libs/telegram/src/processor/message-processor.ts`, delete line 8:

```typescript
import { createRouter } from '../router/factory';
```

- [ ] **Step 2: Replace the routing-table lookup with a direct binding read**

Replace lines 81-113 (from `let session = await this.deps.sessionManager.findActiveSession(...)` through the closing `}` of the `if (!session)` block):

```typescript
      let session = await this.deps.sessionManager.findActiveSession(account.id, chatId);

      if (!session) {
        if (!account.agentId) {
          logger.warn({ accountId: account.id }, 'No agent bound to Telegram account — dropping message');
          return;
        }

        session = await this.deps.sessionManager.createSession({
          tenantId: account.tenantId,
          accountId: account.id,
          chatId,
          contactName: fromName,
          agentId: account.agentId,
        });
      }
```

Note: this introduces a `logger` reference. Check whether `MessageProcessorDeps` or the class already has a logger — if not, add one at the top of the file the same way other `libs/telegram` modules do (`createLogger` from `@chatbot/shared`). Confirm by checking the top of `libs/telegram/src/session/command-handler.ts` for the established import/instantiation pattern, and mirror it:

```typescript
import { createLogger } from '@chatbot/shared';

const logger = createLogger('telegram:message-processor');
```

Add this import and `const logger = ...` line near the top of `message-processor.ts`, alongside the other imports (after the `TelegramCommandHandler` import, before the `createRouter` import you just removed).

- [ ] **Step 3: Type-check the telegram lib**

Run: `bunx tsc --noEmit -p libs/telegram/tsconfig.json`
Expected: no errors

- [ ] **Step 4: Run telegram unit tests**

Run: `nx test telegram`
Expected: all existing tests pass (no test currently covers `processMessageEvent`, so this only confirms nothing else broke)

- [ ] **Step 5: Commit**

```bash
git add libs/telegram/src/processor/message-processor.ts
git commit -m "$(cat <<'EOF'
refactor(telegram): read agentId directly from TelegramAccount, drop router lookup

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Stop creating a default `TelegramRouting` row on connect

**Files:**
- Modify: `apps/web-ui/app/api/telegram/connect/route.ts:64-71`

- [ ] **Step 1: Remove the routing-row creation block**

In `apps/web-ui/app/api/telegram/connect/route.ts`, delete the block (lines 64-71):

```typescript
    await (prisma as any).telegramRouting.create({
      data: {
        accountId: account.id,
        strategy: 'keyword',
        config: {},
        fallbackAgentId: null,
      },
    });

```

A freshly connected `TelegramAccount` is now simply unbound (`agentId: null`) until the tenant picks it from a trigger-node dropdown and saves the agent — no separate routing record needed.

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit -p apps/web-ui/tsconfig.json`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/app/api/telegram/connect/route.ts
git commit -m "$(cat <<'EOF'
refactor(telegram): stop creating a routing row when connecting a bot

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Delete dead routing code, pages, routes, and UI links

**Files:**
- Delete: `libs/telegram/src/router/factory.ts`, `libs/telegram/src/router/keyword-router.ts`, `libs/telegram/src/router/router.interface.ts`
- Modify: `libs/telegram/src/index.ts`
- Delete: `apps/web-ui/app/(dashboard)/settings/channels/telegram/[id]/routing/page.tsx`
- Delete: `apps/web-ui/app/api/telegram/accounts/[id]/routing/route.ts`
- Delete: `apps/web-ui/app/api/telegram/routing/route.ts`
- Modify: `apps/web-ui/app/(dashboard)/settings/channels/telegram/page.tsx`

- [ ] **Step 1: Delete the router implementation files**

```bash
git rm libs/telegram/src/router/factory.ts libs/telegram/src/router/keyword-router.ts libs/telegram/src/router/router.interface.ts
```

- [ ] **Step 2: Remove the router exports from the telegram lib's public API**

In `libs/telegram/src/index.ts`, delete lines 10-11:

```typescript
export { createRouter } from './router/factory';
export type { TelegramRouter, RoutingContext, RoutingResult } from './router/router.interface';
```

- [ ] **Step 3: Delete the routing settings page and its API routes**

```bash
git rm "apps/web-ui/app/(dashboard)/settings/channels/telegram/[id]/routing/page.tsx"
git rm "apps/web-ui/app/api/telegram/accounts/[id]/routing/route.ts"
git rm "apps/web-ui/app/api/telegram/routing/route.ts"
```

If `git rm` reports the parent directories are now empty, that's expected — empty directories aren't tracked by git.

- [ ] **Step 4: Remove the "Routing" button from the Telegram channels list**

In `apps/web-ui/app/(dashboard)/settings/channels/telegram/page.tsx`, the actions cell (around lines 163-184) currently renders two buttons — a routing gear icon and a disconnect trash icon:

```tsx
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => router.push(`/settings/channels/telegram/${row.original.id}/routing`)}
              aria-label="Routing"
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => setDisconnectTarget(row.original)}
              aria-label="Disconnect"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
```

Replace it with just the disconnect button:

```tsx
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => setDisconnectTarget(row.original)}
              aria-label="Disconnect"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
```

Then check whether `Settings` (from `lucide-react`) and `router` (from `useRouter`) are still used elsewhere in this file — if the only use of either was the deleted button, remove their now-unused imports/declarations too (search the file for `Settings` and `router.` to confirm).

- [ ] **Step 5: Type-check and run telegram + web-ui tests**

Run:
```bash
bunx tsc --noEmit -p libs/telegram/tsconfig.json
bunx tsc --noEmit -p apps/web-ui/tsconfig.json
nx test telegram
```
Expected: no errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(telegram): remove routing-rules engine and settings UI

The canvas (telegram_trigger node dropdown + save-time sync) is now the
single source of truth for which agent handles a connected bot's messages.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full affected test + typecheck suite**

```bash
nx affected -t test
bunx tsc --noEmit -p apps/web-ui/tsconfig.json
bunx tsc --noEmit -p libs/telegram/tsconfig.json
bunx tsc --noEmit -p libs/agent-studio/tsconfig.json
bunx tsc --noEmit -p libs/shared/tsconfig.json
```
Expected: all green

- [ ] **Step 2: Manual end-to-end walkthrough**

With the dev server running (`bun run dev`):
1. Connect a fresh Telegram bot (Settings → Channels → Telegram → Connect) — confirm no "Routing" button appears in the accounts table any more
2. Open a graph agent, add a Telegram Trigger node, confirm the new bot appears in the "Connected Bot" dropdown
3. Select it, save the agent — query `TelegramAccount` (Prisma Studio: `bunx prisma studio`) and confirm `agentId`/`triggerNodeId` are now set
4. Open a *different* agent, add a Telegram Trigger node — confirm the now-bound bot does **not** appear in its dropdown
5. Send a real message to the bot via Telegram — confirm it reaches the bound agent and gets a response, with no routing-config table involved
6. In the first agent, remove the Telegram Trigger node (or clear its `accountId`) and save — confirm the binding clears (`agentId`/`triggerNodeId` back to `null`) and the bot reappears as available in other agents' dropdowns
7. Add two Telegram Trigger nodes to one agent, both with an `accountId` set, and try to save — confirm the save is rejected with "Only one Telegram Trigger can be bound to an account per agent"
8. Disconnect the bot — confirm the `TelegramAccount` row is deleted (and therefore its binding is gone) and a freshly reconnected bot starts unbound

- [ ] **Step 3: Update or remove any e2e specs referencing the deleted routing page**

```bash
grep -rln "telegram.*routing\|routing.*telegram" apps/web-ui-e2e/src --include="*.ts" -i
```
If any specs reference `/settings/channels/telegram/[id]/routing`, update them to reflect the new dropdown-based flow or remove the now-obsolete assertions (confirm with the user before deleting any e2e spec content).

- [ ] **Step 4: Final status check**

```bash
git status
git log --oneline -15
```
Expected: clean working tree, a clear sequence of scoped commits matching the tasks above
