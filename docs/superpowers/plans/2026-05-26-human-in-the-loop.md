# Human-in-the-Loop (HITL) Pause/Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make graph agents pause at Human nodes, persist state durably, stream the pause prompt to the client, and resume execution asynchronously via a worker job when the user replies — forming a complete, serverless-safe pause/resume cycle.

**Architecture:** The `GraphExecutor` calls an `onPause` callback (injected via `ExecutionOptions`) when it detects `__paused: true`. The loop logic lives in a shared private `runLoop()` so both `execute()` and `executeFromState()` stay DRY. The inference route's `onPause` handler atomically claims a `PausedExecution` DB record. The resume endpoint (`POST /api/v1/resume`) claims the token with a CAS DB update (prevents double-resume even under concurrent requests), then enqueues a pg-boss `resume-agent-execution` job. The worker runs the graph continuation and stores the final text in `ApiKeyExecution`. The client polls `GET /api/v1/executions/:id` for the result. A nightly pg-boss cron sweeps expired paused executions.

**Tech Stack:** TypeScript, Prisma (PostgreSQL), Next.js API routes, pg-boss (worker job + cron), Vitest, Zod

---

## Prerequisites

The graph agent branch in `apps/web-ui/app/api/v1/inference/route.ts` is currently a stub. **Task 4 replaces it with real `GraphExecutor` execution.** Tasks 1–3 can be built and tested independently.

---

## Playground Follow-on (implemented 2026-05-26)

HITL was extended to the playground canvas with a separate inline resume path:

| File | Change |
|---|---|
| `apps/web-ui/app/api/agents/[id]/playground/route.ts` | Added `onPause` — stores `PausedExecution`, marks `AgentExecution.status = 'paused'` |
| `apps/web-ui/app/api/agents/[id]/playground/resume/route.ts` | New endpoint — session auth, CAS claim, `executeFromState()` inline, SSE streaming |
| `apps/web-ui/hooks/use-playground.ts` | Handles `execution_paused` SSE event, exposes `pauseInfo` + `handleResume()` |
| `apps/web-ui/app/(dashboard)/agents/[id]/playground/page.tsx` | Amber pause banner, routes `ChatInput.onSend` to `handleResume` when paused |

The playground resume is **synchronous inline** (no worker, no polling) because the playground is interactive and not serverless-constrained. The API key path remains async (worker + 202 + polling) for serverless safety. See `docs/dev/changes/2026-05-26-hitl-playground-support.md` for full details.

---

## API Key Path Follow-on Upgrade (not yet implemented)

> If polling feels too slow and you want streaming restored on the resumed continuation, add **Postgres `LISTEN/NOTIFY`**:
>
> 1. Worker publishes `text_delta` events via `pg_notify('exec:{executionId}', JSON.stringify(event))`
> 2. Add `GET /api/v1/executions/:id/stream` — opens SSE, does `LISTEN exec:{id}`, forwards notifications to client
> 3. Client opens this SSE connection after `POST /resume` returns 202
>
> No Redis needed — you already have Postgres. API shape doesn't change. This upgrade is drop-in once polling is working.

---

## Files

| Action | Path | Responsibility |
|---|---|---|
| Modify | `prisma/schema.prisma` | Add `PausedExecution` model |
| Create | `libs/shared/src/services/paused-execution-service.ts` | CRUD + atomic token claiming |
| Create | `libs/shared/src/services/paused-execution-service.test.ts` | Unit tests |
| Modify | `libs/shared/src/index.ts` | Export service |
| Modify | `libs/agent-studio/src/execution/types.ts` | Add `onPause` + `PauseInfo` to `ExecutionOptions` |
| Modify | `libs/agent-studio/src/execution/graph-executor.ts` | Extract `runLoop()`, add `executeFromState()`, detect pause |
| Modify | `libs/agent-studio/src/execution/graph-executor.test.ts` | Pause detection tests |
| Modify | `apps/web-ui/app/api/v1/inference/route.ts` | Replace graph stub with real executor + SSE + onPause |
| Create | `apps/web-ui/app/api/v1/resume/route.ts` | `POST /api/v1/resume` — async 202 |
| Create | `apps/web-ui/app/api/v1/executions/[id]/route.ts` | `GET /api/v1/executions/:id` — polling |
| Create | `apps/workers/src/jobs/resume-agent-execution/schema.ts` | Job payload Zod schema |
| Create | `apps/workers/src/jobs/resume-agent-execution/handler.ts` | Resume execution logic |
| Create | `apps/workers/src/jobs/resume-agent-execution/register.ts` | pg-boss registration |
| Create | `apps/workers/src/jobs/expire-paused-executions/handler.ts` | Expiry sweep |
| Create | `apps/workers/src/jobs/expire-paused-executions/register.ts` | pg-boss cron registration |
| Modify | `apps/workers/src/boss.ts` | Register both new jobs |

---

## Task 1: Prisma — `PausedExecution` model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the model**

In `prisma/schema.prisma`, after the `AgentExecution` model (around line 300), add:

```prisma
model PausedExecution {
  id            String    @id @default(cuid())
  resumeToken   String    @unique @default(uuid())
  tenantId      String
  agentId       String
  executionId   String    // references ApiKeyExecution.id (loose coupling — no FK)
  graphState    Json      // full GraphState at pause point
  prompt        String    // HumanNodeConfig.prompt — shown to user
  outputChannel String    // HumanNodeConfig.outputChannel — where to write reply
  nextNodeId    String?   // first node after human node (null if terminal)
  expiresAt     DateTime
  resumedAt     DateTime? // null until claimed; single-use enforcement
  createdAt     DateTime  @default(now())

  @@index([tenantId])
  @@index([resumeToken])
  @@index([expiresAt])
  @@index([executionId])
  @@map("paused_executions")
}
```

- [ ] **Step 2: Create and apply migration**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
bunx prisma migrate dev --name add-paused-execution --schema=./prisma/schema.prisma
```

Expected: migration created under `prisma/migrations/`, Prisma client regenerated.

- [ ] **Step 3: Verify client has the new model**

```bash
node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); console.log(typeof p.pausedExecution.create);"
```

Expected: prints `function`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add PausedExecution model for HITL pause/resume"
```

---

## Task 2: `PausedExecutionService` with atomic token claiming

**Files:**
- Create: `libs/shared/src/services/paused-execution-service.ts`
- Create: `libs/shared/src/services/paused-execution-service.test.ts`
- Modify: `libs/shared/src/index.ts`

The key method is `claimToken()` — it does an atomic `updateMany` where `resumedAt IS NULL`. If two concurrent requests race on the same token, only one gets `count: 1`. The other gets `count: 0` and is rejected. This replaces the old `markResumed()`-before-execution pattern that had a crash-loss bug.

- [ ] **Step 1: Write the failing tests**

Create `libs/shared/src/services/paused-execution-service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PausedExecutionService } from './paused-execution-service';

function makeDb() {
  return {
    pausedExecution: {
      create: vi.fn().mockResolvedValue({ id: 'pe-1', resumeToken: 'token-abc' }),
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    apiKeyExecution: {
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

describe('PausedExecutionService', () => {
  let db: ReturnType<typeof makeDb>;
  let svc: PausedExecutionService;

  beforeEach(() => {
    db = makeDb();
    svc = new PausedExecutionService(db as any);
  });

  describe('create', () => {
    it('creates a record with 24h expiry', async () => {
      const before = Date.now();
      await svc.create({
        tenantId: 'tenant-1',
        agentId: 'agent-1',
        executionId: 'exec-1',
        graphState: { channels: {}, messages: [], currentNodeId: null, metadata: {} as any },
        prompt: 'What is your name?',
        outputChannel: 'userName',
        nextNodeId: 'llm-2',
      });
      const callArg = db.pausedExecution.create.mock.calls[0][0].data;
      expect(callArg.tenantId).toBe('tenant-1');
      expect(callArg.prompt).toBe('What is your name?');
      expect(callArg.outputChannel).toBe('userName');
      expect(callArg.nextNodeId).toBe('llm-2');
      const expiresAt = new Date(callArg.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThan(before + 23 * 60 * 60 * 1000);
      expect(expiresAt).toBeLessThan(before + 25 * 60 * 60 * 1000);
    });

    it('returns the created record', async () => {
      const result = await svc.create({
        tenantId: 'tenant-1', agentId: 'agent-1', executionId: 'exec-1',
        graphState: { channels: {}, messages: [], currentNodeId: null, metadata: {} as any },
        prompt: 'q', outputChannel: 'out', nextNodeId: null,
      });
      expect(result).toEqual({ id: 'pe-1', resumeToken: 'token-abc' });
    });
  });

  describe('claimToken', () => {
    it('returns the row when token is valid and unclaimed', async () => {
      const row = {
        id: 'pe-1', resumeToken: 'tok', tenantId: 'tenant-1', agentId: 'agent-1',
        executionId: 'exec-1', graphState: {}, prompt: 'q', outputChannel: 'out',
        nextNodeId: 'n2', expiresAt: new Date(Date.now() + 60_000),
        resumedAt: null, createdAt: new Date(),
      };
      db.pausedExecution.findUnique = vi.fn().mockResolvedValue(row);
      db.pausedExecution.updateMany = vi.fn().mockResolvedValue({ count: 1 });

      const result = await svc.claimToken('tok');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('pe-1');
    });

    it('returns null when token not found', async () => {
      db.pausedExecution.updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const result = await svc.claimToken('bad-token');
      expect(result).toBeNull();
    });

    it('returns null when token already claimed (count 0 from CAS)', async () => {
      db.pausedExecution.updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const result = await svc.claimToken('already-used');
      expect(result).toBeNull();
    });

    it('returns null when token is expired (count 0 from CAS)', async () => {
      db.pausedExecution.updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const result = await svc.claimToken('expired-token');
      expect(result).toBeNull();
    });

    it('uses WHERE resumedAt IS NULL AND expiresAt > now in the CAS update', async () => {
      db.pausedExecution.updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const before = Date.now();
      await svc.claimToken('tok');
      const where = db.pausedExecution.updateMany.mock.calls[0][0].where;
      expect(where.resumeToken).toBe('tok');
      expect(where.resumedAt).toEqual(null);
      expect(new Date(where.expiresAt.gt).getTime()).toBeGreaterThanOrEqual(before - 100);
    });
  });

  describe('expireOld', () => {
    it('marks expired unclaimed records and returns count', async () => {
      db.pausedExecution.updateMany = vi.fn().mockResolvedValue({ count: 3 });
      const count = await svc.expireOld();
      const where = db.pausedExecution.updateMany.mock.calls[0][0].where;
      expect(where.resumedAt).toEqual(null);
      expect(where.expiresAt).toBeDefined();
      expect(count).toBe(3);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
nx test shared 2>&1 | grep -E "PausedExecution|FAIL" | head -10
```

Expected: FAIL — service doesn't exist yet.

- [ ] **Step 3: Implement the service**

Create `libs/shared/src/services/paused-execution-service.ts`:

```typescript
import type { GraphState } from '@chatbot/agent-studio';

interface PausedExecutionDb {
  pausedExecution: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string; resumeToken: string }>;
    findUnique(args: { where: { resumeToken: string } }): Promise<PausedExecutionRow | null>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  apiKeyExecution: {
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface PausedExecutionRow {
  id: string;
  resumeToken: string;
  tenantId: string;
  agentId: string;
  executionId: string;
  graphState: unknown;
  prompt: string;
  outputChannel: string;
  nextNodeId: string | null;
  expiresAt: Date;
  resumedAt: Date | null;
  createdAt: Date;
}

export interface CreatePausedExecutionInput {
  tenantId: string;
  agentId: string;
  executionId: string;
  graphState: GraphState;
  prompt: string;
  outputChannel: string;
  nextNodeId: string | null;
}

const EXPIRY_HOURS = 24;

export class PausedExecutionService {
  constructor(private readonly db: PausedExecutionDb) {}

  async create(input: CreatePausedExecutionInput): Promise<{ id: string; resumeToken: string }> {
    const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);
    return this.db.pausedExecution.create({
      data: {
        tenantId: input.tenantId,
        agentId: input.agentId,
        executionId: input.executionId,
        graphState: input.graphState as unknown as Record<string, unknown>,
        prompt: input.prompt,
        outputChannel: input.outputChannel,
        nextNodeId: input.nextNodeId,
        expiresAt,
      },
    });
  }

  /**
   * Atomically claims a resume token using a CAS update.
   * WHERE resumeToken = ? AND resumedAt IS NULL AND expiresAt > now
   * Returns null if the token is invalid, expired, or already claimed.
   * Concurrent callers with the same token: only one gets count=1.
   */
  async claimToken(resumeToken: string): Promise<PausedExecutionRow | null> {
    const result = await this.db.pausedExecution.updateMany({
      where: {
        resumeToken,
        resumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { resumedAt: new Date() },
    });

    if (result.count === 0) return null;

    return this.db.pausedExecution.findUnique({ where: { resumeToken } });
  }

  async expireOld(): Promise<number> {
    const result = await this.db.pausedExecution.updateMany({
      where: {
        resumedAt: null,
        expiresAt: { lt: new Date() },
      },
      data: { resumedAt: new Date() },
    });
    return result.count;
  }
}
```

- [ ] **Step 4: Export from shared index**

In `libs/shared/src/index.ts`, add after the `WebhookService` export:

```typescript
export { PausedExecutionService } from './services/paused-execution-service';
export type { PausedExecutionRow, CreatePausedExecutionInput } from './services/paused-execution-service';
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
nx test shared 2>&1 | tail -10
```

Expected: all `PausedExecutionService` tests pass.

- [ ] **Step 6: Commit**

```bash
git add libs/shared/src/services/paused-execution-service.ts \
        libs/shared/src/services/paused-execution-service.test.ts \
        libs/shared/src/index.ts
git commit -m "feat(shared): add PausedExecutionService with atomic token claiming"
```

---

## Task 3: Graph executor — `runLoop()` extraction + `onPause` callback

**Files:**
- Modify: `libs/agent-studio/src/execution/types.ts`
- Modify: `libs/agent-studio/src/execution/graph-executor.ts`
- Modify: `libs/agent-studio/src/execution/graph-executor.test.ts`

The key DRY fix: extract the while-loop into a private `runLoop(initialState, graph, metadata, options)` method. Both `execute()` (which builds state from scratch) and `executeFromState()` (which uses saved state) call `runLoop()`. Pause detection lives in `runLoop()` once.

- [ ] **Step 1: Write failing tests**

Read `libs/agent-studio/src/execution/graph-executor.test.ts` first to understand existing helpers (`mockServices`, `GraphDefinition`, etc.), then add this `describe` block at the end:

```typescript
describe('GraphExecutor — human node pause', () => {
  it('calls onPause callback when a node sets __paused: true', async () => {
    const onPause = vi.fn().mockResolvedValue(undefined);
    const executor = new GraphExecutor(mockServices);

    executor.register({
      type: 'human',
      execute: async (ctx) => ({
        stateUpdates: { __paused: true, __resumeToken: 'tok-123' },
        next: null,
        trace: { nodeId: ctx.node.id, nodeType: 'human', status: 'paused', startedAt: new Date().toISOString() },
      }),
    });

    const graph: GraphDefinition = {
      nodes: [
        { id: 'human-1', type: 'human', label: 'Ask name', config: { type: 'human', prompt: 'What is your name?', outputChannel: 'userName' }, position: { x: 0, y: 0 } },
        { id: 'llm-2', type: 'llm', label: 'Continue', config: { type: 'llm', model: 'test' }, position: { x: 0, y: 1 } },
      ],
      edges: [{ id: 'e1', source: 'human-1', target: 'llm-2' }],
    };

    await executor.execute(
      graph,
      { messages: [{ role: 'user', content: 'hi' }] },
      { executionId: 'exec-1', agentId: 'agent-1', tenantId: 'tenant-1', userId: 'user-1' },
      { onPause }
    );

    expect(onPause).toHaveBeenCalledOnce();
    expect(onPause).toHaveBeenCalledWith({
      resumeToken: 'tok-123',
      nextNodeId: 'llm-2',
      prompt: 'What is your name?',
      outputChannel: 'userName',
      state: expect.objectContaining({ channels: expect.objectContaining({ __paused: true }) }),
    });
  });

  it('stops graph execution after pause — does not run next node', async () => {
    const nodesSeen: string[] = [];
    const executor = new GraphExecutor(mockServices);

    executor.register({
      type: 'human',
      execute: async (ctx) => {
        nodesSeen.push(ctx.node.id);
        return {
          stateUpdates: { __paused: true, __resumeToken: 'tok-456' },
          next: null,
          trace: { nodeId: ctx.node.id, nodeType: 'human', status: 'paused', startedAt: new Date().toISOString() },
        };
      },
    });

    executor.register({
      type: 'llm',
      execute: async (ctx) => {
        nodesSeen.push(ctx.node.id);
        return {
          stateUpdates: {},
          next: null,
          trace: { nodeId: ctx.node.id, nodeType: 'llm', status: 'completed', startedAt: new Date().toISOString() },
        };
      },
    });

    const graph: GraphDefinition = {
      nodes: [
        { id: 'human-1', type: 'human', label: 'Ask', config: { type: 'human', prompt: 'q', outputChannel: 'out' }, position: { x: 0, y: 0 } },
        { id: 'llm-2', type: 'llm', label: 'Continue', config: { type: 'llm', model: 'test' }, position: { x: 0, y: 1 } },
      ],
      edges: [{ id: 'e1', source: 'human-1', target: 'llm-2' }],
    };

    await executor.execute(
      graph,
      { messages: [] },
      { executionId: 'exec-1', agentId: 'agent-1', tenantId: 'tenant-1', userId: 'user-1' },
      { onPause: vi.fn().mockResolvedValue(undefined) }
    );

    expect(nodesSeen).toEqual(['human-1']); // llm-2 never ran
  });

  it('emits execution_paused event when paused', async () => {
    const events: string[] = [];
    const executor = new GraphExecutor(mockServices);

    executor.register({
      type: 'human',
      execute: async (ctx) => ({
        stateUpdates: { __paused: true, __resumeToken: 'tok-789' },
        next: null,
        trace: { nodeId: ctx.node.id, nodeType: 'human', status: 'paused', startedAt: new Date().toISOString() },
      }),
    });

    const graph: GraphDefinition = {
      nodes: [{ id: 'h1', type: 'human', label: 'Ask', config: { type: 'human', prompt: 'p', outputChannel: 'o' }, position: { x: 0, y: 0 } }],
      edges: [],
    };

    await executor.execute(
      graph,
      { messages: [] },
      { executionId: 'exec-1', agentId: 'agent-1', tenantId: 'tenant-1', userId: 'user-1' },
      {
        onEvent: (e) => events.push(e.type),
        onPause: vi.fn().mockResolvedValue(undefined),
      }
    );

    expect(events).toContain('execution_paused');
  });

  it('executeFromState resumes from injected state without re-running prior nodes', async () => {
    const nodesSeen: string[] = [];
    const executor = new GraphExecutor(mockServices);

    executor.register({
      type: 'llm',
      execute: async (ctx) => {
        nodesSeen.push(ctx.node.id);
        return {
          stateUpdates: { response: 'hello' },
          next: null,
          trace: { nodeId: ctx.node.id, nodeType: 'llm', status: 'completed', startedAt: new Date().toISOString() },
        };
      },
    });

    const graph: GraphDefinition = {
      nodes: [
        { id: 'human-1', type: 'human', label: 'Ask', config: { type: 'human', prompt: 'q', outputChannel: 'userName' }, position: { x: 0, y: 0 } },
        { id: 'llm-2', type: 'llm', label: 'Continue', config: { type: 'llm', model: 'test' }, position: { x: 0, y: 1 } },
      ],
      edges: [{ id: 'e1', source: 'human-1', target: 'llm-2' }],
    };

    const restoredState = {
      channels: { userName: 'Omar', __paused: false },
      messages: [],
      currentNodeId: 'llm-2',
      metadata: { executionId: 'exec-1', agentId: 'agent-1', tenantId: 'tenant-1', userId: 'user-1', startedAt: new Date() },
    };

    await executor.executeFromState(
      graph,
      restoredState,
      { executionId: 'exec-1', agentId: 'agent-1', tenantId: 'tenant-1', userId: 'user-1' }
    );

    expect(nodesSeen).toEqual(['llm-2']); // human-1 not re-run
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
nx test agent-studio 2>&1 | grep -E "human node pause|FAIL" | head -10
```

Expected: 4 new tests fail.

- [ ] **Step 3: Add `PauseInfo` and `onPause` to `types.ts`**

In `libs/agent-studio/src/execution/types.ts`, replace `ExecutionOptions` with:

```typescript
export interface PauseInfo {
  resumeToken: string;
  nextNodeId: string | null;
  prompt: string;
  outputChannel: string;
  state: GraphState;
}

export interface ExecutionOptions {
  onEvent?: (event: ExecutionEvent) => void;
  signal?: AbortSignal;
  maxSteps?: number;
  onPause?: (info: PauseInfo) => Promise<void>;
}
```

- [ ] **Step 4: Refactor `graph-executor.ts` — extract `runLoop`, add `executeFromState`**

Replace the full contents of `libs/agent-studio/src/execution/graph-executor.ts` with:

```typescript
import { createLogger } from '@chatbot/shared';
import type {
  GraphState,
  ExecutionServices,
  NodeExecutor,
  ExecutionEvent,
  ExecutionOptions,
  NodeTraceEntry,
  NodeExecutionContext,
  PauseInfo,
} from './types';
import type { GraphDefinition, GraphNode } from '../types/agent';
import { createInitialState, applyStateUpdates } from './state';

const logger = createLogger('agent-studio:graph-executor');

const DEFAULT_MAX_STEPS = 50;

export class GraphExecutor {
  private executors = new Map<string, NodeExecutor>();

  constructor(private services: ExecutionServices) {}

  register(executor: NodeExecutor): void {
    this.executors.set(executor.type, executor);
  }

  async execute(
    graph: GraphDefinition,
    input: { messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> },
    metadata: { executionId: string; agentId: string; tenantId: string; userId: string },
    options: ExecutionOptions = {}
  ): Promise<GraphState> {
    const initialState = createInitialState({
      executionId: metadata.executionId,
      agentId: metadata.agentId,
      tenantId: metadata.tenantId,
      userId: metadata.userId,
      messages: input.messages,
    });
    return this.runLoop({ ...initialState, currentNodeId: this.findEntryNode(graph).id }, graph, metadata, options);
  }

  async executeFromState(
    graph: GraphDefinition,
    state: GraphState,
    metadata: { executionId: string; agentId: string; tenantId: string; userId: string },
    options: ExecutionOptions = {}
  ): Promise<GraphState> {
    return this.runLoop(state, graph, metadata, options);
  }

  private async runLoop(
    initialState: GraphState,
    graph: GraphDefinition,
    metadata: { executionId: string; agentId: string; tenantId: string; userId: string },
    options: ExecutionOptions
  ): Promise<GraphState> {
    const { onEvent, signal, maxSteps = DEFAULT_MAX_STEPS } = options;
    const traces: NodeTraceEntry[] = [];
    const emit = (event: ExecutionEvent): void => { onEvent?.(event); };

    let state = initialState;
    let steps = 0;

    logger.info({ executionId: metadata.executionId, startNodeId: state.currentNodeId }, 'starting graph loop');

    try {
      while (state.currentNodeId) {
        if (signal?.aborted) {
          logger.warn({ executionId: metadata.executionId, step: steps }, 'execution aborted');
          break;
        }

        if (steps >= maxSteps) {
          logger.warn({ executionId: metadata.executionId, maxSteps }, 'max steps reached');
          break;
        }

        const node = graph.nodes.find((n) => n.id === state.currentNodeId);
        if (!node) {
          const error = `node not found: ${state.currentNodeId}`;
          logger.error({ executionId: metadata.executionId, nodeId: state.currentNodeId }, error);
          throw new Error(error);
        }

        const executor = this.executors.get(node.type);
        if (!executor) {
          const error = `no executor registered for node type: ${node.type}`;
          emit({ type: 'node_error', nodeId: node.id, error });
          logger.error({ executionId: metadata.executionId, nodeId: node.id, nodeType: node.type }, error);
          throw new Error(error);
        }

        emit({ type: 'node_start', nodeId: node.id, nodeType: node.type });
        const startedAt = Date.now();

        try {
          const ctx: NodeExecutionContext = { state, node, config: node.config, services: this.services, emit };
          const result = await executor.execute(ctx);

          state = applyStateUpdates(state, result.stateUpdates);
          emit({ type: 'state_update', channels: state.channels });

          // ── Pause detection ────────────────────────────────────────────
          if (state.channels.__paused === true) {
            const resumeToken = state.channels.__resumeToken as string;
            const humanConfig = node.config as { prompt?: string; outputChannel?: string };
            const nextEdge = graph.edges.find((e) => e.source === node.id);
            const nextNodeId = nextEdge?.target ?? null;

            const pauseInfo: PauseInfo = {
              resumeToken,
              nextNodeId,
              prompt: humanConfig.prompt ?? '',
              outputChannel: humanConfig.outputChannel ?? '',
              state,
            };

            emit({ type: 'execution_paused', reason: pauseInfo.prompt, resumeToken });

            if (options.onPause) {
              await options.onPause(pauseInfo);
            }

            const trace: NodeTraceEntry = { ...result.trace, durationMs: Date.now() - startedAt };
            traces.push(trace);
            state = { ...state, currentNodeId: null };
            steps++;
            continue;
          }
          // ── Normal completion ──────────────────────────────────────────

          const trace: NodeTraceEntry = { ...result.trace, durationMs: Date.now() - startedAt };
          traces.push(trace);
          emit({ type: 'node_complete', nodeId: node.id, trace });

          const nextNodeId = this.resolveNextNode(node, result.next, graph);
          state = { ...state, currentNodeId: nextNodeId };
        } catch (nodeError) {
          const errorMessage = nodeError instanceof Error ? nodeError.message : String(nodeError);
          const failedTrace: NodeTraceEntry = {
            nodeId: node.id, nodeType: node.type, nodeLabel: node.label,
            status: 'failed', startedAt: new Date(startedAt).toISOString(),
            completedAt: new Date().toISOString(), error: errorMessage,
            durationMs: Date.now() - startedAt,
          };
          traces.push(failedTrace);
          emit({ type: 'node_error', nodeId: node.id, error: errorMessage });
          logger.error({ executionId: metadata.executionId, nodeId: node.id, error: errorMessage }, 'node execution failed');
          throw nodeError;
        }

        steps++;
      }
    } catch (error) {
      logger.error({ executionId: metadata.executionId, error }, 'graph execution failed');
      throw error;
    }

    emit({ type: 'execution_complete', finalState: state, trace: traces });
    logger.info({ executionId: metadata.executionId, steps, traceCount: traces.length }, 'graph execution complete');

    return state;
  }

  private findEntryNode(graph: GraphDefinition): GraphNode {
    const targetIds = new Set(graph.edges.map((e) => e.target));
    const entryNodes = graph.nodes.filter((n) => !targetIds.has(n.id));
    if (entryNodes.length === 0) throw new Error('no entry node found: all nodes have incoming edges');
    return entryNodes[0];
  }

  private resolveNextNode(currentNode: GraphNode, resultNext: string[] | null, graph: GraphDefinition): string | null {
    if (resultNext && resultNext.length > 0) return resultNext[0];
    const outgoingEdges = graph.edges.filter((e) => e.source === currentNode.id);
    if (outgoingEdges.length === 0) return null;
    return outgoingEdges[0].target;
  }
}
```

- [ ] **Step 5: Run all tests**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
nx test agent-studio 2>&1 | tail -12
```

Expected: all tests pass including 4 new pause tests.

- [ ] **Step 6: Commit**

```bash
git add libs/agent-studio/src/execution/types.ts \
        libs/agent-studio/src/execution/graph-executor.ts \
        libs/agent-studio/src/execution/graph-executor.test.ts
git commit -m "feat(graph-executor): extract runLoop, add executeFromState, add onPause callback"
```

---

## Task 4: Wire real graph execution into the inference route

**Files:**
- Modify: `apps/web-ui/app/api/v1/inference/route.ts`

Replace the entire `if (agent.type === 'graph') { ... }` block (the stub) with:

- [ ] **Step 1: Replace the graph agent stub**

```typescript
// ─── Graph Agent Execution ────────────────────────────────────────────
if (agent.type === 'graph') {
  const graphConfig = config as { nodes?: any[]; edges?: any[] };
  const graph = { nodes: graphConfig.nodes ?? [], edges: graphConfig.edges ?? [] };

  if (graph.nodes.length === 0) {
    return new Response(
      JSON.stringify({ error: { type: 'agent_not_configured', message: 'Graph has no nodes' } }),
      { status: 400 }
    );
  }

  const { GraphExecutor, createNodeExecutors } = await import('@chatbot/agent-studio/server');
  const { PausedExecutionService } = await import('@chatbot/shared');
  const pausedExecService = new PausedExecutionService(db);

  const llmProviderFn = async (providerId?: string, modelId?: string) => {
    const llmProviderService = new LlmProviderService(tenantId);
    const providerCfg = providerId
      ? await llmProviderService.getConfigById(providerId)
      : modelId
        ? await resolveProviderForModel(tenantId, modelId)
        : null;
    const cfg = providerCfg ?? (await llmProviderService.getDefaultConfig());
    const { createLLMProvider } = await import('@chatbot/ai');
    return createLLMProvider(cfg);
  };

  const graphExecutor = new GraphExecutor({ llmProvider: llmProviderFn, prisma: db });
  for (const exec of createNodeExecutors()) graphExecutor.register(exec);

  const inboxMessages = sessionId ? [...priorMessages, ...messages] : messages;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = (data: unknown) =>
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));

      try {
        let paused = false;

        const finalState = await graphExecutor.execute(
          graph,
          { messages: inboxMessages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content ?? '' })) },
          { executionId, agentId, tenantId, userId: '' },
          {
            onEvent: (event) => enc(event),
            onPause: async (pauseInfo) => {
              paused = true;
              await pausedExecService.create({
                tenantId, agentId, executionId,
                graphState: pauseInfo.state,
                prompt: pauseInfo.prompt,
                outputChannel: pauseInfo.outputChannel,
                nextNodeId: pauseInfo.nextNodeId,
              });
              await db.apiKeyExecution.update({
                where: { id: executionId },
                data: { status: 'paused' },
              });
            },
          }
        );

        if (!paused) {
          const text = String((finalState.channels.__output as string) ?? '');
          const completedAt = new Date();
          await db.apiKeyExecution.update({
            where: { id: executionId },
            data: { status: 'completed', output: { text }, completedAt, latencyMs: completedAt.getTime() - startedAt.getTime() },
          });
          if (sessionId) {
            await sessionService.appendMessage(sessionId, { role: 'assistant', content: text });
          }
          enc({ type: 'done', text });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ executionId, agentId, tenantId, err: msg }, 'graph agent execution failed');
        await db.apiKeyExecution.update({
          where: { id: executionId },
          data: { status: 'failed', error: msg, completedAt: new Date() },
        });
        enc({ type: 'error', message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'x-execution-id': executionId,
      ...(sessionId ? { 'x-session-id': sessionId } : {}),
    },
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/app/api/v1/inference/route.ts
git commit -m "feat(inference): wire real GraphExecutor with SSE streaming and onPause handler"
```

---

## Task 5: Resume API — async `POST /api/v1/resume`

**Files:**
- Create: `apps/web-ui/app/api/v1/resume/route.ts`

Returns 202 immediately after claiming the token and enqueuing the pg-boss job. No inline execution, no SSE from this endpoint.

- [ ] **Step 1: Create the route**

Create `apps/web-ui/app/api/v1/resume/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { getPrismaClient, createLogger, PausedExecutionService } from '@chatbot/shared';
import { validateInferenceApiKey } from '../inference/lib/auth';
import { z } from 'zod';
import PgBoss from 'pg-boss';
import { env } from '../inference/lib/env';

const logger = createLogger('api:resume');

const bodySchema = z.object({
  resumeToken: z.string().min(1),
  userInput: z.string().min(1, 'userInput is required'),
});

export async function POST(req: NextRequest) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) return authResult.response;

  const { tenantId } = authResult.auth;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return new Response(
      JSON.stringify({ error: { type: 'invalid_request', message: 'resumeToken and userInput are required' } }),
      { status: 400 }
    );
  }

  const { resumeToken, userInput } = body;
  const db = getPrismaClient();
  const pausedExecService = new PausedExecutionService(db);

  // Atomic CAS claim — prevents double-resume under concurrent requests
  const paused = await pausedExecService.claimToken(resumeToken);
  if (!paused) {
    return new Response(
      JSON.stringify({ error: { type: 'invalid_token', message: 'Resume token is invalid, expired, or already used' } }),
      { status: 410 }
    );
  }

  if (paused.tenantId !== tenantId) {
    return new Response(
      JSON.stringify({ error: { type: 'forbidden', message: 'Token does not belong to this tenant' } }),
      { status: 403 }
    );
  }

  // Enqueue worker job — execution happens async
  const boss = new PgBoss({ connectionString: env.DATABASE_URL });
  await boss.start();
  await boss.send('resume-agent-execution', {
    pausedExecutionId: paused.id,
    userInput,
    tenantId,
  });
  await boss.stop();

  logger.info({ pausedExecutionId: paused.id, executionId: paused.executionId, tenantId }, 'resume job enqueued');

  return new Response(
    JSON.stringify({ executionId: paused.executionId, status: 'queued' }),
    { status: 202, headers: { 'Content-Type': 'application/json' } }
  );
}
```

- [ ] **Step 2: Create the polling endpoint**

Create `apps/web-ui/app/api/v1/executions/[id]/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { validateInferenceApiKey } from '../../inference/lib/auth';

const logger = createLogger('api:executions');

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) return authResult.response;

  const { tenantId } = authResult.auth;
  const { id } = params;

  const db = getPrismaClient();
  const execution = await db.apiKeyExecution.findUnique({ where: { id } });

  if (!execution || execution.tenantId !== tenantId) {
    return new Response(JSON.stringify({ error: { type: 'not_found', message: 'Execution not found' } }), { status: 404 });
  }

  logger.debug({ executionId: id, status: execution.status, tenantId }, 'execution status polled');

  return new Response(
    JSON.stringify({
      executionId: id,
      status: execution.status,           // 'running' | 'completed' | 'failed' | 'paused'
      output: execution.output ?? null,   // { text: string } when completed
      error: execution.error ?? null,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/app/api/v1/resume/route.ts \
        apps/web-ui/app/api/v1/executions/[id]/route.ts
git commit -m "feat(resume): add async POST /api/v1/resume and GET /api/v1/executions/:id polling"
```

---

## Task 6: Resume worker job

**Files:**
- Create: `apps/workers/src/jobs/resume-agent-execution/schema.ts`
- Create: `apps/workers/src/jobs/resume-agent-execution/handler.ts`
- Create: `apps/workers/src/jobs/resume-agent-execution/register.ts`

- [ ] **Step 1: Create the schema**

Create `apps/workers/src/jobs/resume-agent-execution/schema.ts`:

```typescript
import { z } from 'zod';

export const resumeAgentExecutionSchema = z.object({
  pausedExecutionId: z.string().min(1),
  userInput: z.string().min(1),
  tenantId: z.string().min(1),
});
```

- [ ] **Step 2: Create the handler**

Create `apps/workers/src/jobs/resume-agent-execution/handler.ts`:

```typescript
import { getPrismaClient, PausedExecutionService, LlmProviderService, createLogger } from '@chatbot/shared';
import { resumeAgentExecutionSchema } from './schema.js';
import { createLogger as workerLogger } from '../../lib/logger.js';

const log = workerLogger('resume-agent-execution');

export async function handleResumeAgentExecution(data: unknown): Promise<void> {
  const { pausedExecutionId, userInput, tenantId } = resumeAgentExecutionSchema.parse(data);

  const db = getPrismaClient();
  const pausedExecService = new PausedExecutionService(db as any);

  // Load the paused execution (already claimed by the API — resumedAt is set)
  const paused = await (db as any).pausedExecution.findUnique({ where: { id: pausedExecutionId } });
  if (!paused) {
    log.warn({ pausedExecutionId }, 'Paused execution not found, skipping');
    return;
  }

  // Restore state and inject human reply
  const savedState = paused.graphState as any;
  const restoredState = {
    ...savedState,
    channels: {
      ...savedState.channels,
      [paused.outputChannel]: userInput,
      __paused: false,
      __resumeToken: null,
    },
    currentNodeId: paused.nextNodeId,
  };

  // Load agent version for graph definition
  const execution = await (db as any).apiKeyExecution.findUnique({ where: { id: paused.executionId } });
  if (!execution) {
    log.warn({ executionId: paused.executionId }, 'ApiKeyExecution not found, skipping');
    return;
  }

  const agentVersion = await (db as any).agentVersion.findUnique({ where: { id: execution.agentVersionId } });
  const graphCfg = agentVersion?.config as { nodes?: any[]; edges?: any[] } | null ?? {};
  const graph = { nodes: graphCfg.nodes ?? [], edges: graphCfg.edges ?? [] };

  const { GraphExecutor, createNodeExecutors } = await import('@chatbot/agent-studio/server');

  const llmProviderFn = async (providerId?: string, modelId?: string) => {
    const llmProviderService = new LlmProviderService(tenantId);
    const providerCfg = providerId
      ? await llmProviderService.getConfigById(providerId)
      : null;
    const cfg = providerCfg ?? (await llmProviderService.getDefaultConfig());
    const { createLLMProvider } = await import('@chatbot/ai');
    return createLLMProvider(cfg);
  };

  const graphExecutor = new GraphExecutor({ llmProvider: llmProviderFn, prisma: db });
  for (const exec of createNodeExecutors()) graphExecutor.register(exec);

  log.info({ pausedExecutionId, executionId: paused.executionId, nextNodeId: paused.nextNodeId }, 'Resuming graph execution');

  try {
    let secondPause = false;

    const finalState = await graphExecutor.executeFromState(
      graph,
      restoredState,
      { executionId: paused.executionId, agentId: paused.agentId, tenantId, userId: savedState.metadata?.userId ?? 'system' },
      {
        onPause: async (pauseInfo) => {
          secondPause = true;
          await pausedExecService.create({
            tenantId, agentId: paused.agentId, executionId: paused.executionId,
            graphState: pauseInfo.state,
            prompt: pauseInfo.prompt,
            outputChannel: pauseInfo.outputChannel,
            nextNodeId: pauseInfo.nextNodeId,
          });
          await (db as any).apiKeyExecution.update({
            where: { id: paused.executionId },
            data: { status: 'paused' },
          });
        },
      }
    );

    if (!secondPause) {
      const text = String((finalState.channels.__output as string) ?? '');
      await (db as any).apiKeyExecution.update({
        where: { id: paused.executionId },
        data: { status: 'completed', output: { text }, completedAt: new Date() },
      });
      log.info({ executionId: paused.executionId, outputLength: text.length }, 'Graph resume completed');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ pausedExecutionId, executionId: paused.executionId, err: msg }, 'Graph resume failed');
    await (db as any).apiKeyExecution.update({
      where: { id: paused.executionId },
      data: { status: 'failed', error: msg, completedAt: new Date() },
    });
    throw err;
  }
}
```

- [ ] **Step 3: Create the register**

Create `apps/workers/src/jobs/resume-agent-execution/register.ts`:

```typescript
import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { handleResumeAgentExecution } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('resume-agent-execution-register');
const JOB_NAME = 'resume-agent-execution';

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  if (executor.registerHandler) {
    executor.registerHandler(JOB_NAME, handleResumeAgentExecution);
  }

  await boss.createQueue(JOB_NAME);
  await boss.work(JOB_NAME, { batchSize: 5 }, async (jobs) => {
    for (const job of jobs) {
      log.info('Processing resume job', { jobId: job.id });
      await executor.execute(JOB_NAME, job.data);
    }
  });

  log.info('Registered job handler', { jobName: JOB_NAME });
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/workers/src/jobs/resume-agent-execution/
git commit -m "feat(workers): add resume-agent-execution job handler"
```

---

## Task 7: Expiry cron + wire both jobs into boss.ts

**Files:**
- Create: `apps/workers/src/jobs/expire-paused-executions/handler.ts`
- Create: `apps/workers/src/jobs/expire-paused-executions/register.ts`
- Modify: `apps/workers/src/boss.ts`

- [ ] **Step 1: Create the expiry handler**

Create `apps/workers/src/jobs/expire-paused-executions/handler.ts`:

```typescript
import { getPrismaClient, PausedExecutionService } from '@chatbot/shared';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('expire-paused-executions');

export async function handleExpirePausedExecutions(_data: unknown): Promise<void> {
  const db = getPrismaClient();
  const svc = new PausedExecutionService(db as any);
  const count = await svc.expireOld();

  if (count > 0) {
    // Mark parent executions as failed
    const expired = await (db as any).pausedExecution.findMany({
      where: { resumedAt: { not: null }, expiresAt: { lt: new Date() } },
      select: { executionId: true },
      take: 500,
    });
    for (const { executionId } of expired) {
      await (db as any).apiKeyExecution.updateMany({
        where: { id: executionId, status: 'paused' },
        data: { status: 'failed', error: 'Human input timeout — resume token expired', completedAt: new Date() },
      });
    }
  }

  log.info({ expiredCount: count }, 'Expired paused executions swept');
}
```

- [ ] **Step 2: Create the expiry register**

Create `apps/workers/src/jobs/expire-paused-executions/register.ts`:

```typescript
import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { handleExpirePausedExecutions } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('expire-paused-executions-register');
const JOB_NAME = 'expire-paused-executions';
const CRON_SCHEDULE = '30 0 * * *'; // 00:30 UTC daily (06:00 IST)

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  if (executor.registerHandler) {
    executor.registerHandler(JOB_NAME, handleExpirePausedExecutions);
  }

  await boss.createQueue(JOB_NAME);
  await boss.work(JOB_NAME, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      log.info('Running expiry sweep', { jobId: job.id });
      await executor.execute(JOB_NAME, job.data);
    }
  });

  await boss.schedule(JOB_NAME, CRON_SCHEDULE, {}, { tz: 'UTC' });
  log.info('Registered cron job', { jobName: JOB_NAME, schedule: CRON_SCHEDULE });
}
```

- [ ] **Step 3: Register both jobs in boss.ts**

Open `apps/workers/src/boss.ts`. Add imports and registrations alongside the existing ones:

```typescript
import { register as registerResumeAgentExecution } from './jobs/resume-agent-execution/register.js';
import { register as registerExpirePausedExecutions } from './jobs/expire-paused-executions/register.js';

// Inside startup, alongside existing registrations:
await registerResumeAgentExecution(boss, executor);
await registerExpirePausedExecutions(boss, executor);
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
bunx tsc --noEmit -p apps/workers/tsconfig.json 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/workers/src/jobs/expire-paused-executions/ \
        apps/workers/src/boss.ts
git commit -m "feat(workers): add expire-paused-executions cron and wire both jobs into boss"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| `PausedExecution` DB model | Task 1 |
| Atomic CAS token claiming | Task 2 (`claimToken`) |
| 24h expiry on create | Task 2 |
| DRY: shared `runLoop()` | Task 3 |
| `executeFromState()` for resume | Task 3 |
| `onPause` callback + `PauseInfo` | Task 3 |
| `execution_paused` SSE event | Task 3 |
| Graph stops after pause | Task 3 |
| Real graph execution in inference route | Task 4 |
| SSE streaming of graph events | Task 4 |
| Resume token persisted on pause | Task 4 |
| `POST /api/v1/resume` → 202 async | Task 5 |
| Tenant ownership check | Task 5 |
| `GET /api/v1/executions/:id` polling | Task 5 |
| Worker runs graph continuation | Task 6 |
| Chained human node support | Task 6 |
| Nightly expiry sweep 00:30 UTC | Task 7 |
| Expired executions marked failed | Task 7 |

**Type consistency:** `claimToken()` in Task 2 returns `PausedExecutionRow | null` — used in Task 5 route. `PauseInfo` defined in Task 3 `types.ts` — used in Task 3 executor and Task 4 inference route. `resumeAgentExecutionSchema` fields match what Task 5 sends to pg-boss. All consistent.

**Follow-on upgrade (not implemented):** If polling feels sluggish and you want streaming back on resume, add Postgres `LISTEN/NOTIFY`. Worker calls `pg_notify('exec:{executionId}', payload)`. New endpoint `GET /api/v1/executions/:id/stream` does `LISTEN exec:{id}` and pipes notifications as SSE. No Redis, no API shape changes. Drop-in upgrade.
