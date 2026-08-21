# Claw Scheduled Tasks (Cron) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make *"read the Jira board and email me a report every day at 10am"* work unattended — time-triggered autonomous Claw runs with per-task least-privilege tool grants and channel delivery.

**Architecture:** Ported from nucleus's production `agent-ops-scheduler` (446 runs across 5 live tasks at time of writing). One pg-boss sweeper on one tick queue evaluates cron in-app with `croner`; a due tick acquires a `(taskId, scheduledAt)` lock, creates a `ClawRun` with `source: 'scheduled'`, and calls the **existing unchanged** `executeRun()`. A new `approvalPolicy` on the graph replaces the blunt `autoApprove` boolean so a scheduled task can auto-approve exactly the tools it needs and still gate everything else.

**Tech Stack:** TypeScript strict, Prisma + PostgreSQL, pg-boss 10.4, `croner`, `cronstrue`, LangGraph, Vitest, Next.js 15 App Router, shadcn/ui, TanStack Query, Zod, T3 Env, Pino.

**Spec:** `docs/superpowers/specs/2026-07-30-claw-soul-and-cron-design.md` (§6, §7.4)

**Depends on:** D1 (workspace files — provides the `scheduled` prompt surface so `heartbeat` is injected) and D2 (`grantedTools` plumbing on the graph, which this plan generalises into `approvalPolicy`).

**Reference sources in `/Users/H2702/.superset/projects/nucleus-prod/nucleus-cloud-ops` (branch `master-v1`, read-only):**

| Port target | Nucleus source |
|---|---|
| Sweeper + `selectDueTasks` | `apps/workers/src/jobs/agent-ops-scheduler/index.ts` |
| Service + `validateScheduleInput` + lock | `apps/web-ui/lib/agent-ops/scheduled-task-service.ts` |
| Delivery | `apps/web-ui/lib/agent-ops/scheduled-notifier.ts` |
| Cron picker | `apps/web-ui/components/agent-ops/cron-picker.tsx` |
| Task dialog | `apps/web-ui/components/agent-ops/scheduled-task-dialog.tsx` |
| NL → cron distillation | `apps/web-ui/app/api/agent-ops/scheduled-tasks/distill/route.ts` |
| Schema | `libs/prisma/schema.prisma:492-538` |

## Global Constraints

- **Non-regression (spec §7.4).** Pre-effort baseline: `Test Files 48 passed (48)`, `Tests 443 passed (443)`. D1 and D2 added to that. This plan must keep everything green and only add.
- **`executeRun()` must not be modified.** It is already source-agnostic; that is the entire reason cron is cheap here. If you find yourself editing it, stop and reconsider.
- **Do NOT modify:** `libs/claw-studio/src/integrations/**`, `connectors/adapters/{slack,telegram,discord}.ts`, `gateway/{execute-run,gateway-service,event-bus,run-service}.ts`, `memory/**`, `skills/**`, `mcp/**`, `agent/tool-classifier.ts`.
- **Only pre-existing files this plan touches:** `prisma/schema.prisma` (additive), `libs/claw-studio/src/agent/claw-graph.ts`, `libs/claw-studio/src/agent/claw-runtime.ts`, `libs/claw-studio/src/gateway/types.ts` (additive only), `libs/claw-studio/src/gateway/notification-router.ts` (one new action), `libs/claw-studio/src/env.ts`, `libs/claw-studio/src/index.ts`, `apps/workers/src/index.ts` (register the job), `apps/mission-control/lib/nav-config.ts`, `apps/mission-control/lib/queue.ts` (one new queue name), `libs/claw-studio/CLAUDE.md`.
- **`sendScheduledNotification` is OPTIONAL on `ChannelAdapter`.** Optional means Slack/Telegram/Discord stay valid with zero edits. Do not make it required.
- **Guards:** `CLAW_MIN_INTERVAL_MINUTES` (15), `CLAW_MAX_ACTIVE_TASKS_PER_TENANT` (25), `failureStreak` auto-pause at 3, per-task `maxIterations`.
- **UI conventions:** follow the *Mission Control UI Conventions* section in `2026-07-30-claw-plan-d1-workspace-files.md` **exactly** — thin page files with no heading, `h1 text-2xl font-semibold` in the client, two-arg `toast.success("Title", { description })`, `DataTable` + `DataTableColumnHeader` for tables, and `DropdownMenuTrigger render={<Button/>}` rather than `asChild`. Mission Control is already shadcn; match the existing pages, do not introduce a new look.
- **Standards:** Zod at every route boundary and form; env via T3 Env only; try/catch everywhere with Pino structured context `{ tenantId, taskId, runId }`.
- **Tests:** `cd libs/claw-studio && bunx vitest run` — must be run with that cwd.
- **Code style:** no comments unless the *why* is non-obvious; no multi-line docstrings.

---

### Task 1: Prisma models

**Files:**
- Modify: `prisma/schema.prisma` (append after `ClawFileRevision` from D1; add one back-relation to `model Claw`)

**Interfaces:**
- Produces: `db.clawScheduledTask`, `db.clawScheduledTaskLock`

- [ ] **Step 1: Add both models**

Append to `prisma/schema.prisma`:

```prisma
// ClawScheduledTask — a recurring or one-off autonomous Claw run. Ported from
// nucleus ScheduledTask (libs/prisma/schema.prisma:492).
//
// taskId is a globally unique random token rather than a composite
// (tenantId, taskId): it travels in Slack/Telegram button payloads and console
// URLs, so it has to be unguessable and self-contained anyway — the same
// reasoning already documented on ClawRun.runId.
//
// approvalMode/allowedTools are least-privilege for unattended runs: a 10am
// report grants gmail_send_message and nothing else. Blanket autoApprove is
// still available as approvalMode='all'.
model ClawScheduledTask {
  id              String    @id @default(cuid())
  tenantId        String
  clawId          String
  taskId          String    @unique
  name            String
  prompt          String    @db.Text
  scheduleType    String    @default("cron") // cron|interval|once
  cronExpression  String    @default("") // empty unless scheduleType=cron
  intervalMinutes Int?
  runAt           DateTime? // scheduleType=once
  timezone        String    @default("UTC")
  status          String    @default("active") // active|paused|completed|deleted
  approvalMode    String    @default("ask") // ask|allowlist|all
  allowedTools    String[]  @default([])
  sessionMode     String    @default("isolated") // isolated|main
  maxIterations   Int?
  providerModelId String?
  delivery        Json      @default("{}") // { type, target }
  lastRunId       String?
  lastRunAt       DateTime?
  lastRunStatus   String?
  nextRunAt       DateTime?
  runCount        Int       @default(0)
  failureStreak   Int       @default(0)
  createdBy       String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  claw Claw @relation(fields: [clawId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([status])
  @@index([tenantId, status])
  @@map("claw_scheduled_tasks")
}

// ClawScheduledTaskLock — ON CONFLICT on (taskId, scheduledAt) gives atomic lock
// acquisition, so two worker replicas sweeping the same due minute cannot both
// launch the run. 1h TTL cleans itself up.
model ClawScheduledTaskLock {
  id          String   @id @default(cuid())
  taskId      String
  scheduledAt String
  acquiredAt  DateTime @default(now())
  expiresAt   DateTime

  @@unique([taskId, scheduledAt])
  @@index([expiresAt])
  @@map("claw_scheduled_task_locks")
}
```

- [ ] **Step 2: Add the back-relation**

In `model Claw`, after the `files ClawFile[]` line added in D1:

```prisma
  scheduledTasks ClawScheduledTask[]
```

- [ ] **Step 3: Migrate and add deps**

Run:
```bash
bunx prisma migrate dev --name add_claw_scheduled_tasks
bun add croner cronstrue
```
Expected: migration applied, client regenerated, both packages installed.

- [ ] **Step 4: Typecheck**

Run: `cd libs/claw-studio && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations package.json bun.lock
git commit -m "feat(claw-studio): add ClawScheduledTask and lock models"
```

---

### Task 2: `selectDueTasks` — the pure due-selection function

**Files:**
- Create: `libs/claw-studio/src/scheduler/types.ts`
- Create: `libs/claw-studio/src/scheduler/select-due-tasks.ts`
- Test: `libs/claw-studio/src/scheduler/select-due-tasks.test.ts`

**Interfaces:**
- Produces:
  - `interface ActiveTaskRow { taskId: string; tenantId: string; scheduleType: string; cronExpression: string; intervalMinutes: number | null; runAt: Date | null; timezone: string; nextRunAt: Date | null }`
  - `function selectDueTasks(tasks: ActiveTaskRow[], nowMs: number, windowMs: number): ActiveTaskRow[]`
  - `const DUE_WINDOW_MS = 60_000`
  - `type ScheduleType = 'cron' | 'interval' | 'once'`
  - `type TaskStatus = 'active' | 'paused' | 'completed' | 'deleted'`
  - `type ApprovalMode = 'ask' | 'allowlist' | 'all'`
  - `type SessionMode = 'isolated' | 'main'`
  - `interface TaskDelivery { type: 'slack' | 'telegram' | 'discord' | 'jira' | 'email' | 'none'; target?: string }`

This is the file the whole scheduler's correctness rests on. No DB, no queue, no clock — `nowMs` is
injected — which is why it can be tested exhaustively in milliseconds.

- [ ] **Step 1: Write the failing test**

Create `libs/claw-studio/src/scheduler/select-due-tasks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DUE_WINDOW_MS, selectDueTasks } from './select-due-tasks';
import type { ActiveTaskRow } from './types';

const row = (over: Partial<ActiveTaskRow> = {}): ActiveTaskRow => ({
  taskId: 't-1',
  tenantId: 'tenant-1',
  scheduleType: 'cron',
  cronExpression: '0 10 * * *',
  intervalMinutes: null,
  runAt: null,
  timezone: 'UTC',
  nextRunAt: null,
  ...over,
});

const at = (iso: string) => new Date(iso).getTime();

describe('selectDueTasks — cron', () => {
  it('selects a task 30s after its scheduled minute', () => {
    const due = selectDueTasks([row()], at('2026-07-30T10:00:30Z'), DUE_WINDOW_MS);
    expect(due).toHaveLength(1);
  });

  it('does not select it two minutes later', () => {
    const due = selectDueTasks([row()], at('2026-07-30T10:02:00Z'), DUE_WINDOW_MS);
    expect(due).toHaveLength(0);
  });

  it('does not select it before it fires', () => {
    const due = selectDueTasks([row()], at('2026-07-30T09:59:00Z'), DUE_WINDOW_MS);
    expect(due).toHaveLength(0);
  });

  it('respects the task timezone', () => {
    const kolkata = row({ timezone: 'Asia/Kolkata' });
    // 10:00 IST is 04:30 UTC
    expect(selectDueTasks([kolkata], at('2026-07-30T04:30:20Z'), DUE_WINDOW_MS)).toHaveLength(1);
    expect(selectDueTasks([kolkata], at('2026-07-30T10:00:20Z'), DUE_WINDOW_MS)).toHaveLength(0);
  });

  it('skips a malformed cron expression without throwing', () => {
    expect(() =>
      selectDueTasks([row({ cronExpression: 'not a cron' })], at('2026-07-30T10:00:30Z'), DUE_WINDOW_MS),
    ).not.toThrow();
    expect(selectDueTasks([row({ cronExpression: 'not a cron' })], at('2026-07-30T10:00:30Z'), DUE_WINDOW_MS)).toHaveLength(0);
  });

  it('skips an empty cron expression', () => {
    expect(selectDueTasks([row({ cronExpression: '' })], at('2026-07-30T10:00:30Z'), DUE_WINDOW_MS)).toHaveLength(0);
  });
});

describe('selectDueTasks — interval', () => {
  const iv = (over: Partial<ActiveTaskRow> = {}) =>
    row({ scheduleType: 'interval', cronExpression: '', intervalMinutes: 30, ...over });

  it('selects when the anchor has passed', () => {
    const due = selectDueTasks([iv({ nextRunAt: new Date('2026-07-30T09:00:00Z') })], at('2026-07-30T10:00:00Z'), DUE_WINDOW_MS);
    expect(due).toHaveLength(1);
  });

  it('does not select before the anchor', () => {
    const due = selectDueTasks([iv({ nextRunAt: new Date('2026-07-30T11:00:00Z') })], at('2026-07-30T10:00:00Z'), DUE_WINDOW_MS);
    expect(due).toHaveLength(0);
  });

  it('fires once when the anchor is null', () => {
    expect(selectDueTasks([iv({ nextRunAt: null })], at('2026-07-30T10:00:00Z'), DUE_WINDOW_MS)).toHaveLength(1);
  });

  it('skips an interval task with no or invalid intervalMinutes', () => {
    expect(selectDueTasks([iv({ intervalMinutes: null })], at('2026-07-30T10:00:00Z'), DUE_WINDOW_MS)).toHaveLength(0);
    expect(selectDueTasks([iv({ intervalMinutes: 0 })], at('2026-07-30T10:00:00Z'), DUE_WINDOW_MS)).toHaveLength(0);
    expect(selectDueTasks([iv({ intervalMinutes: -5 })], at('2026-07-30T10:00:00Z'), DUE_WINDOW_MS)).toHaveLength(0);
  });
});

describe('selectDueTasks — once', () => {
  const once = (over: Partial<ActiveTaskRow> = {}) =>
    row({ scheduleType: 'once', cronExpression: '', ...over });

  it('selects when runAt has passed', () => {
    expect(selectDueTasks([once({ runAt: new Date('2026-07-30T09:00:00Z') })], at('2026-07-30T10:00:00Z'), DUE_WINDOW_MS)).toHaveLength(1);
  });

  it('does not select before runAt', () => {
    expect(selectDueTasks([once({ runAt: new Date('2026-07-30T11:00:00Z') })], at('2026-07-30T10:00:00Z'), DUE_WINDOW_MS)).toHaveLength(0);
  });

  it('skips a once task with no runAt', () => {
    expect(selectDueTasks([once({ runAt: null })], at('2026-07-30T10:00:00Z'), DUE_WINDOW_MS)).toHaveLength(0);
  });
});

describe('selectDueTasks — mixed', () => {
  it('evaluates each task independently and one bad row cannot hide a good one', () => {
    const tasks = [
      row({ taskId: 'good', cronExpression: '0 10 * * *' }),
      row({ taskId: 'bad', cronExpression: '!!!' }),
      row({ taskId: 'later', cronExpression: '0 23 * * *' }),
    ];
    const due = selectDueTasks(tasks, at('2026-07-30T10:00:10Z'), DUE_WINDOW_MS);
    expect(due.map((t) => t.taskId)).toEqual(['good']);
  });

  it('returns an empty array for no tasks', () => {
    expect(selectDueTasks([], at('2026-07-30T10:00:00Z'), DUE_WINDOW_MS)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/scheduler/select-due-tasks.test.ts`
Expected: FAIL — cannot resolve `./select-due-tasks`.

- [ ] **Step 3: Write the implementation**

Create `libs/claw-studio/src/scheduler/types.ts`:

```ts
export type ScheduleType = 'cron' | 'interval' | 'once';
export type TaskStatus = 'active' | 'paused' | 'completed' | 'deleted';
export type ApprovalMode = 'ask' | 'allowlist' | 'all';
export type SessionMode = 'isolated' | 'main';

export type DeliveryChannel = 'slack' | 'telegram' | 'discord' | 'jira' | 'email' | 'none';

export interface TaskDelivery {
  type: DeliveryChannel;
  target?: string;
}

/** The minimal projection the sweeper needs to decide what is due. */
export interface ActiveTaskRow {
  taskId: string;
  tenantId: string;
  scheduleType: string;
  cronExpression: string;
  intervalMinutes: number | null;
  runAt: Date | null;
  timezone: string;
  nextRunAt: Date | null;
}

export interface ScheduledTaskRecord {
  id: string;
  tenantId: string;
  clawId: string;
  taskId: string;
  name: string;
  prompt: string;
  scheduleType: ScheduleType;
  cronExpression: string;
  intervalMinutes: number | null;
  runAt: Date | null;
  timezone: string;
  status: TaskStatus;
  approvalMode: ApprovalMode;
  allowedTools: string[];
  sessionMode: SessionMode;
  maxIterations: number | null;
  providerModelId: string | null;
  delivery: TaskDelivery;
  lastRunId: string | null;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  nextRunAt: Date | null;
  runCount: number;
  failureStreak: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Create `libs/claw-studio/src/scheduler/select-due-tasks.ts`:

```ts
import { Cron } from 'croner';
import { createLogger } from '@chatbot/shared';
import type { ActiveTaskRow } from './types';

const logger = createLogger('claw-studio:scheduler:select');

// A task counts as due if its most recent scheduled occurrence is within this
// window. Mirrors pg-boss's own timekeeper (prevDiff < 60) and pairs with
// singletonSeconds:60 on the enqueue, so the two 30s sweeps that fall inside one
// due-minute collapse to a single tick.
export const DUE_WINDOW_MS = 60_000;

function cronDue(task: ActiveTaskRow, nowMs: number, windowMs: number): boolean {
  if (!task.cronExpression.trim()) return false;
  try {
    const cron = new Cron(task.cronExpression, { timezone: task.timezone });
    const prev = cron.previousRuns(1, new Date(nowMs))[0];
    return !!prev && nowMs - prev.getTime() < windowMs;
  } catch (error) {
    logger.warn(
      { taskId: task.taskId, cronExpression: task.cronExpression, error: error instanceof Error ? error.message : String(error) },
      'Invalid cron expression — skipping task',
    );
    return false;
  }
}

/**
 * Pure selection of which active tasks are due at `nowMs`. Never throws: one
 * malformed row must not stop every other tenant's schedule.
 */
export function selectDueTasks(tasks: ActiveTaskRow[], nowMs: number, windowMs: number): ActiveTaskRow[] {
  return tasks.filter((task) => {
    if (task.scheduleType === 'interval') {
      if (!task.intervalMinutes || task.intervalMinutes <= 0) {
        logger.warn({ taskId: task.taskId }, 'Interval task without a positive intervalMinutes — skipping');
        return false;
      }
      return task.nextRunAt === null || task.nextRunAt.getTime() <= nowMs;
    }
    if (task.scheduleType === 'once') {
      return task.runAt !== null && task.runAt.getTime() <= nowMs;
    }
    return cronDue(task, nowMs, windowMs);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd libs/claw-studio && bunx vitest run src/scheduler/select-due-tasks.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/scheduler
git commit -m "feat(claw-studio): add pure selectDueTasks scheduler logic"
```

---

### Task 3: `ScheduledTaskService`

**Files:**
- Create: `libs/claw-studio/src/scheduler/scheduled-task-service.ts`
- Test: `libs/claw-studio/src/scheduler/scheduled-task-service.test.ts`
- Modify: `libs/claw-studio/src/env.ts`

**Interfaces:**
- Consumes: `ActiveTaskRow`, `ScheduledTaskRecord`, `TaskDelivery` (Task 2)
- Produces:
  ```ts
  function generateTaskId(): string;                  // 'task_' + 18 base64url chars
  function validateSchedule(input: { scheduleType?: string; cronExpression?: string; intervalMinutes?: unknown; runAt?: unknown }): string | null;
  function computeNextRunAt(task: Pick<ActiveTaskRow,'scheduleType'|'cronExpression'|'timezone'|'intervalMinutes'|'runAt'>, fromMs: number): Date | null;

  class ScheduledTaskService {
    constructor(tenantId: string, db?: PrismaClient);
    create(input: CreateTaskInput): Promise<ScheduledTaskRecord>;
    get(taskId: string): Promise<ScheduledTaskRecord | null>;
    list(): Promise<ScheduledTaskRecord[]>;
    update(taskId: string, patch: UpdateTaskInput): Promise<ScheduledTaskRecord | null>;
    remove(taskId: string): Promise<void>;
    grantTool(taskId: string, toolName: string): Promise<void>;
    recordRun(taskId: string, runId: string, status: string): Promise<{ autoPaused: boolean }>;
  }
  class ScheduledTaskService_Statics {}  // (not real — see module-level fns below)

  // module-level, tenant-agnostic (used by the worker)
  function listAllActiveTasks(db?: PrismaClient): Promise<ActiveTaskRow[]>;
  function advanceIntervalAnchor(taskId: string, intervalMinutes: number, nowMs: number, db?: PrismaClient): Promise<void>;
  function tryAcquireLock(taskId: string, scheduledAt: string, db?: PrismaClient): Promise<boolean>;
  function completeOnceTask(taskId: string, db?: PrismaClient): Promise<void>;

  class TaskLimitError extends Error {}
  class InvalidScheduleError extends Error {}
  const FAILURE_STREAK_LIMIT = 3;
  ```

`recordRun` returns `{ autoPaused }` so the caller can notify the channel when a task pauses itself.

- [ ] **Step 1: Write the failing test**

Create `libs/claw-studio/src/scheduler/scheduled-task-service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAILURE_STREAK_LIMIT, InvalidScheduleError, ScheduledTaskService, TaskLimitError,
  computeNextRunAt, generateTaskId, validateSchedule,
} from './scheduled-task-service';

describe('generateTaskId', () => {
  it('produces unguessable prefixed ids', () => {
    const a = generateTaskId();
    expect(a).toMatch(/^task_[A-Za-z0-9_-]{18,}$/);
    expect(a).not.toBe(generateTaskId());
  });
});

describe('validateSchedule', () => {
  it('accepts a valid cron', () => {
    expect(validateSchedule({ scheduleType: 'cron', cronExpression: '0 10 * * *' })).toBeNull();
  });

  it('rejects a missing cron expression', () => {
    expect(validateSchedule({ scheduleType: 'cron', cronExpression: '  ' })).toMatch(/required/i);
  });

  it('rejects a malformed cron expression', () => {
    expect(validateSchedule({ scheduleType: 'cron', cronExpression: 'nope' })).toMatch(/invalid/i);
  });

  it('rejects a cron that fires more often than the floor', () => {
    expect(validateSchedule({ scheduleType: 'cron', cronExpression: '* * * * *' })).toMatch(/at least/i);
  });

  it('enforces the interval floor', () => {
    expect(validateSchedule({ scheduleType: 'interval', intervalMinutes: 5 })).toMatch(/at least/i);
    expect(validateSchedule({ scheduleType: 'interval', intervalMinutes: 15 })).toBeNull();
  });

  it('requires a future runAt for once', () => {
    expect(validateSchedule({ scheduleType: 'once', runAt: 'not a date' })).toMatch(/valid/i);
    expect(validateSchedule({ scheduleType: 'once', runAt: new Date(Date.now() + 3_600_000).toISOString() })).toBeNull();
  });

  it('rejects an unknown schedule type', () => {
    expect(validateSchedule({ scheduleType: 'weekly' })).toMatch(/cron|interval|once/i);
  });
});

describe('computeNextRunAt', () => {
  const base = { cronExpression: '0 10 * * *', timezone: 'UTC', intervalMinutes: null, runAt: null };

  it('returns the next cron occurrence', () => {
    const next = computeNextRunAt({ ...base, scheduleType: 'cron' }, new Date('2026-07-30T10:30:00Z').getTime());
    expect(next?.toISOString()).toBe('2026-07-31T10:00:00.000Z');
  });

  it('returns now + interval for interval tasks', () => {
    const from = new Date('2026-07-30T10:00:00Z').getTime();
    const next = computeNextRunAt({ ...base, scheduleType: 'interval', intervalMinutes: 30 }, from);
    expect(next?.toISOString()).toBe('2026-07-30T10:30:00.000Z');
  });

  it('returns null for a once task (it does not recur)', () => {
    expect(computeNextRunAt({ ...base, scheduleType: 'once', runAt: new Date() }, Date.now())).toBeNull();
  });

  it('returns null for an unparseable cron rather than throwing', () => {
    expect(computeNextRunAt({ ...base, scheduleType: 'cron', cronExpression: '!!' }, Date.now())).toBeNull();
  });
});

function makeDb(existing: Array<Record<string, unknown>> = []) {
  const rows = [...existing];
  const clawScheduledTask = {
    count: vi.fn(async () => rows.filter((r) => r.status === 'active').length),
    create: vi.fn(async ({ data }: any) => { rows.push({ ...data, runCount: 0, failureStreak: 0 }); return rows.at(-1); }),
    findFirst: vi.fn(async ({ where }: any) => rows.find((r) => r.taskId === where.taskId) ?? null),
    findMany: vi.fn(async () => rows),
    update: vi.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.taskId === where.taskId)!;
      for (const [k, v] of Object.entries(data)) {
        row[k] = v && typeof v === 'object' && 'increment' in (v as any)
          ? (row[k] as number) + (v as any).increment
          : v;
      }
      return row;
    }),
  };
  const clawStudio = {
    findFirst: vi.fn(async () => ({ id: 's1', claws: [{ id: 'c1' }] })),
  };
  return { db: { clawScheduledTask, clawStudio } as any, rows };
}

describe('ScheduledTaskService', () => {
  let harness: ReturnType<typeof makeDb>;
  let svc: ScheduledTaskService;

  beforeEach(() => {
    harness = makeDb();
    svc = new ScheduledTaskService('t1', harness.db);
  });

  const valid = {
    name: 'Daily report',
    prompt: 'Every run, summarise the board.',
    scheduleType: 'cron' as const,
    cronExpression: '0 10 * * *',
    timezone: 'UTC',
  };

  it('creates a task with a computed nextRunAt', async () => {
    const task = await svc.create(valid);
    expect(task.taskId).toMatch(/^task_/);
    expect(task.nextRunAt).toBeInstanceOf(Date);
  });

  it('rejects an invalid schedule', async () => {
    await expect(svc.create({ ...valid, cronExpression: '* * * * *' })).rejects.toThrow(InvalidScheduleError);
  });

  it('enforces the per-tenant active task cap', async () => {
    harness.db.clawScheduledTask.count.mockResolvedValueOnce(25);
    await expect(svc.create(valid)).rejects.toThrow(TaskLimitError);
  });

  it('appends a granted tool without duplicating', async () => {
    const task = await svc.create({ ...valid, allowedTools: ['gmail_send_message'] });
    await svc.grantTool(task.taskId, 'notion_create_page');
    await svc.grantTool(task.taskId, 'notion_create_page');
    const updated = await svc.get(task.taskId);
    expect(updated?.allowedTools).toEqual(['gmail_send_message', 'notion_create_page']);
  });

  it('increments runCount and resets failureStreak on success', async () => {
    const task = await svc.create(valid);
    await svc.recordRun(task.taskId, 'run-1', 'failed');
    const result = await svc.recordRun(task.taskId, 'run-2', 'completed');
    const updated = await svc.get(task.taskId);
    expect(updated?.failureStreak).toBe(0);
    expect(updated?.runCount).toBe(2);
    expect(result.autoPaused).toBe(false);
  });

  it('auto-pauses after consecutive failures', async () => {
    const task = await svc.create(valid);
    let last = { autoPaused: false };
    for (let i = 0; i < FAILURE_STREAK_LIMIT; i++) {
      last = await svc.recordRun(task.taskId, `run-${i}`, 'failed');
    }
    expect(last.autoPaused).toBe(true);
    expect((await svc.get(task.taskId))?.status).toBe('paused');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/scheduler/scheduled-task-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

First add to `libs/claw-studio/src/env.ts`, inside `server`:

```ts
    CLAW_MIN_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
    CLAW_MAX_ACTIVE_TASKS_PER_TENANT: z.coerce.number().int().positive().default(25),
    CLAW_SCHEDULER_SWEEP_MS: z.coerce.number().int().positive().default(30_000),
```

Then create `libs/claw-studio/src/scheduler/scheduled-task-service.ts`. Implement to satisfy the
tests above, with these behaviours:

- `generateTaskId()` — `` `task_${crypto.randomBytes(14).toString('base64url')}` ``.
- `validateSchedule()` — ported from nucleus `validateScheduleInput`, extended with `once` plus a
  **cadence-floor check**: build a `Cron`, take `nextRuns(2)`, and reject if the gap is under
  `env.CLAW_MIN_INTERVAL_MINUTES`. That is what makes `* * * * *` fail.
- `computeNextRunAt()` — cron → `new Cron(expr, { timezone }).nextRun(new Date(fromMs))`; interval →
  `new Date(fromMs + intervalMinutes * 60_000)`; once → `null`; unparseable → `null`, never throws.
- `create()` — validate, then `count({ where: { tenantId, status: 'active' } })` against
  `env.CLAW_MAX_ACTIVE_TASKS_PER_TENANT` (throw `TaskLimitError`), resolve `clawId` via
  `clawStudio.findFirst({ where: { tenantId }, include: { claws: true } })`, generate `taskId`,
  compute `nextRunAt`, create.
- `recordRun()` — on `completed`: `failureStreak: 0`. On `failed`/`cancelled`: increment. Always
  `runCount: { increment: 1 }`, set `lastRunId`/`lastRunAt`/`lastRunStatus`, and recompute
  `nextRunAt`. When the incremented streak reaches `FAILURE_STREAK_LIMIT`, also set
  `status: 'paused'` and return `{ autoPaused: true }`.
- `grantTool()` — read, dedupe, write. (`allowedTools` is a `String[]`; `push` with Prisma would
  duplicate.)
- Module-level `listAllActiveTasks()` — `findMany({ where: { status: 'active' }, select: {...} })`
  returning `ActiveTaskRow[]`, tenant-agnostic for the worker.
- Module-level `tryAcquireLock()` — `create` inside try/catch; a unique-constraint violation
  (Prisma `P2002`) returns `false`. `expiresAt` = now + 1h.
- Module-level `advanceIntervalAnchor()` / `completeOnceTask()` — as named.
- Every method: try/catch + Pino with `{ tenantId, taskId }`, re-throw after logging.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd libs/claw-studio && bunx vitest run src/scheduler/scheduled-task-service.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/scheduler/scheduled-task-service.ts libs/claw-studio/src/scheduler/scheduled-task-service.test.ts libs/claw-studio/src/env.ts
git commit -m "feat(claw-studio): add ScheduledTaskService with schedule validation and guards"
```

---

### Task 4: `approvalPolicy` on the graph

**Files:**
- Modify: `libs/claw-studio/src/agent/claw-graph.ts` (deps; `routeFromGenerateToTools`; `routeFromRevise`; `mutativeApprovalGateNode`)
- Test: `libs/claw-studio/src/agent/claw-graph.test.ts` (extend)

**Interfaces:**
- Consumes: `ApprovalMode` (Task 2); the `grantedTools` Set added in D2 Task 3
- Produces: `ClawGraphDeps` gains `approvalPolicy?: { mode: ApprovalMode; allowedTools?: string[] }`

**This is the change that makes unattended runs possible (spec §2.2b).** `gmail_send_message`
classifies as mutative, so a 10am report would otherwise pause forever at the gate.

**Backward compatibility is mandatory:** `autoApprove: true` must behave exactly as `mode: 'all'`,
and omitting `approvalPolicy` entirely must behave exactly as today. Chat, playground, and gateway
runs all rely on this.

- [ ] **Step 1: Write the failing test**

Append to `libs/claw-studio/src/agent/claw-graph.test.ts`:

```ts
describe('approvalPolicy', () => {
  const sendCall = [{ name: 'gmail_send_message', args: { to: 'a@b.c' } }];

  it('mode "all" runs a mutative tool without gating', async () => {
    const graph = createClawGraph({
      model: makeToolCallingModel(sendCall),
      tenantId: 't1', userId: 'c1',
      checkpointer: makeCheckpointer(),
      approvalPolicy: { mode: 'all' },
    });
    await graph.invoke({ messages: [new HumanMessage('send it')] }, { configurable: { thread_id: 'ap-all' } });
    const snap = await graph.getState({ configurable: { thread_id: 'ap-all' } });
    expect(snap.next ?? []).not.toContain('mutative_approval_gate');
  });

  it('mode "allowlist" runs a listed tool and gates an unlisted one', async () => {
    const listed = createClawGraph({
      model: makeToolCallingModel(sendCall),
      tenantId: 't1', userId: 'c1',
      checkpointer: makeCheckpointer(),
      approvalPolicy: { mode: 'allowlist', allowedTools: ['gmail_send_message'] },
    });
    await listed.invoke({ messages: [new HumanMessage('send it')] }, { configurable: { thread_id: 'ap-listed' } });
    expect((await listed.getState({ configurable: { thread_id: 'ap-listed' } })).next ?? [])
      .not.toContain('mutative_approval_gate');

    const unlisted = createClawGraph({
      model: makeToolCallingModel([{ name: 'notion_create_page', args: {} }]),
      tenantId: 't1', userId: 'c1',
      checkpointer: makeCheckpointer(),
      approvalPolicy: { mode: 'allowlist', allowedTools: ['gmail_send_message'] },
    });
    await unlisted.invoke({ messages: [new HumanMessage('write it up')] }, { configurable: { thread_id: 'ap-unlisted' } });
    expect((await unlisted.getState({ configurable: { thread_id: 'ap-unlisted' } })).next ?? [])
      .toContain('mutative_approval_gate');
  });

  it('mode "ask" gates every mutative tool', async () => {
    const graph = createClawGraph({
      model: makeToolCallingModel(sendCall),
      tenantId: 't1', userId: 'c1',
      checkpointer: makeCheckpointer(),
      approvalPolicy: { mode: 'ask' },
    });
    await graph.invoke({ messages: [new HumanMessage('send it')] }, { configurable: { thread_id: 'ap-ask' } });
    expect((await graph.getState({ configurable: { thread_id: 'ap-ask' } })).next ?? [])
      .toContain('mutative_approval_gate');
  });

  it('REGRESSION: autoApprove:true still behaves exactly as mode "all"', async () => {
    const graph = createClawGraph({
      model: makeToolCallingModel(sendCall),
      tenantId: 't1', userId: 'c1',
      autoApprove: true,
    });
    const state = await graph.invoke({ messages: [new HumanMessage('send it')] });
    expect(state.pendingToolApprovals ?? []).toHaveLength(0);
  });

  it('REGRESSION: omitting approvalPolicy gates mutative tools as before', async () => {
    const graph = createClawGraph({
      model: makeToolCallingModel(sendCall),
      tenantId: 't1', userId: 'c1',
      autoApprove: false,
      checkpointer: makeCheckpointer(),
    });
    await graph.invoke({ messages: [new HumanMessage('send it')] }, { configurable: { thread_id: 'ap-default' } });
    expect((await graph.getState({ configurable: { thread_id: 'ap-default' } })).next ?? [])
      .toContain('mutative_approval_gate');
  });
});
```

Use the file's existing stub helpers rather than the placeholder names above if they differ.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/agent/claw-graph.test.ts`
Expected: FAIL — `approvalPolicy` unknown.

- [ ] **Step 3: Write the implementation**

In `libs/claw-studio/src/agent/claw-graph.ts`:

(a) Add to `ClawGraphDeps`:

```ts
  /** Least-privilege gate control for unattended runs. `autoApprove: true` is
   *  equivalent to { mode: 'all' } and remains supported. */
  approvalPolicy?: { mode: ApprovalMode; allowedTools?: string[] };
```

with `import type { ApprovalMode } from '../scheduler/types';`

(b) In the destructure add `approvalPolicy`, then replace the D2 `granted` line with a single
resolved policy. `autoApprove` must still win so no existing caller changes behaviour:

```ts
  const policyMode: ApprovalMode = autoApprove ? 'all' : (approvalPolicy?.mode ?? 'ask');
  const granted = grantedTools ?? new Set<string>();
  for (const name of approvalPolicy?.allowedTools ?? []) granted.add(name);

  function needsApproval(
    toolCalls: Array<{ name: string; args?: Record<string, unknown>; id?: string }>,
  ) {
    if (policyMode === 'all') return [];
    return filterMutativeToolCalls(toolCalls).filter((tc) => !granted.has(tc.name));
  }
```

(c) In `routeFromGenerateToTools`, delete the `if (autoApprove) return 'tools';` line and the
`filterMutativeToolCalls(...)` line, and use:

```ts
    const mutative = needsApproval(toolCalls);
```

(d) Apply the identical change in `routeFromRevise`.

(e) In `mutativeApprovalGateNode`, replace its `filterMutativeToolCalls(toolCalls)` with
`needsApproval(toolCalls)` so `pendingToolApprovals` matches what the router decided.

(f) Keep the `compileOptions` ternary keyed on `autoApprove` **unchanged**. `mode: 'all'` without
`autoApprove` still compiles the interrupts, but `needsApproval` returns `[]` so they never fire —
and a scheduled task that is later edited down to `ask` keeps working on the same checkpoint.

- [ ] **Step 4: Run the full suite**

Run: `cd libs/claw-studio && bunx vitest run`
Expected: PASS. **Both REGRESSION tests must pass** — they are the contract that chat, playground, and
gateway runs are untouched.

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/agent/claw-graph.ts libs/claw-studio/src/agent/claw-graph.test.ts
git commit -m "feat(claw-studio): add per-run approvalPolicy with least-privilege tool grants"
```

---

### Task 5: Scheduled source, delivery, and the notifier

**Files:**
- Modify: `libs/claw-studio/src/gateway/types.ts` (additive only)
- Create: `libs/claw-studio/src/scheduler/scheduled-notifier.ts`
- Test: `libs/claw-studio/src/scheduler/scheduled-notifier.test.ts`

**Interfaces:**
- Consumes: `ScheduledTaskService` (Task 3); the existing `ConnectorRegistry` and `ClawRunService`
- Produces:
  - `const SCHEDULED_SOURCE = 'scheduled'` in `gateway/types.ts`
  - `ChannelAdapter` gains **optional** `sendScheduledNotification?(task, run, outcome): Promise<void>`
  - `type ScheduledOutcome = 'result' | 'failure' | 'attention'`
  - `ReplyAction` gains `'approve_always'`
  - `function mapRunStatusToOutcome(status: string): ScheduledOutcome | null`
  - `function finalizeScheduledRun(run: ClawRunRecord, opts?: { countRun?: boolean }): Promise<void>`

Ported from nucleus `scheduled-notifier.ts`. **It must never throw** — a delivery failure cannot abort
run finalization — but it must never be silent either: every attempt is recorded as a `notification`
event on the run so a bad bot token shows up in the timeline.

- [ ] **Step 1: Write the failing test**

Create `libs/claw-studio/src/scheduler/scheduled-notifier.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { mapRunStatusToOutcome } from './scheduled-notifier';

describe('mapRunStatusToOutcome', () => {
  it('maps terminal success to result', () => {
    expect(mapRunStatusToOutcome('completed')).toBe('result');
  });

  it('maps failure and cancellation to failure', () => {
    expect(mapRunStatusToOutcome('failed')).toBe('failure');
    expect(mapRunStatusToOutcome('cancelled')).toBe('failure');
  });

  it('maps both awaiting states to attention', () => {
    expect(mapRunStatusToOutcome('awaiting_input')).toBe('attention');
    expect(mapRunStatusToOutcome('awaiting_approval')).toBe('attention');
  });

  it('returns null for non-terminal statuses', () => {
    expect(mapRunStatusToOutcome('queued')).toBeNull();
    expect(mapRunStatusToOutcome('in_progress')).toBeNull();
  });
});
```

Then add `finalizeScheduledRun` tests covering: a non-scheduled run is a no-op; a scheduled run with
`delivery.type: 'none'` records the run but sends nothing; an adapter without
`sendScheduledNotification` records a `notification` failure event rather than throwing; a throwing
adapter is caught and recorded; and a successful send records a `notification` sent event. Mock
`getConnectorRegistry`, `getRunService`, and `ScheduledTaskService` with `vi.mock`, following the
mocking style in the existing `libs/claw-studio/src/gateway/notification-router.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/scheduler/scheduled-notifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

(a) In `libs/claw-studio/src/gateway/types.ts`, **additively**:

```ts
export const SCHEDULED_SOURCE = 'scheduled';

export type ScheduledOutcome = 'result' | 'failure' | 'attention';
```

add `'approve_always'` to the `ReplyAction` union, and add to the `ChannelAdapter` interface:

```ts
  /** Optional: deliver a scheduled run's digest. Adapters without it simply
   *  don't support scheduled delivery — Slack/Telegram/Discord are unaffected
   *  until each implements it. */
  sendScheduledNotification?(
    task: { taskId: string; name: string; delivery: { type: string; target?: string } },
    run: ClawRunRecord,
    outcome: ScheduledOutcome,
  ): Promise<void>;
```

Add `'scheduled'` to the `RunSource` union and to `ACTIVE_RUN_STATUSES`-adjacent constants only if
`RunSource` is a closed union — check first; if it is `string`, no change is needed.

(b) Create `libs/claw-studio/src/scheduler/scheduled-notifier.ts` mirroring nucleus's file:

```ts
import { createLogger } from '@chatbot/shared';
import { getConnectorRegistry } from '../connectors/registry';
import { getRunService } from '../gateway/run-service';
import { SCHEDULED_SOURCE, type ClawRunRecord, type ScheduledOutcome } from '../gateway/types';
import { ScheduledTaskService } from './scheduled-task-service';

const logger = createLogger('claw-studio:scheduler:notifier');

export function mapRunStatusToOutcome(status: string): ScheduledOutcome | null {
  switch (status) {
    case 'completed': return 'result';
    case 'failed':
    case 'cancelled': return 'failure';
    case 'awaiting_input':
    case 'awaiting_approval': return 'attention';
    default: return null;
  }
}

export async function finalizeScheduledRun(
  run: ClawRunRecord,
  opts?: { countRun?: boolean },
): Promise<void> {
  try {
    if (run.source !== SCHEDULED_SOURCE) return;
    const taskId = (run.trigger as { taskId?: string } | null)?.taskId;
    if (!taskId) return;

    const svc = new ScheduledTaskService(run.tenantId);
    const task = await svc.get(taskId);
    if (!task) {
      logger.warn({ taskId, runId: run.runId }, 'Scheduled task not found — skipping finalize');
      return;
    }

    if (opts?.countRun ?? true) {
      const { autoPaused } = await svc.recordRun(taskId, run.runId, run.status);
      if (autoPaused) {
        logger.warn({ taskId, tenantId: run.tenantId }, 'Task auto-paused after consecutive failures');
      }
    }

    await deliver(task, run);
  } catch (error) {
    logger.error({ error, runId: run.runId }, 'finalizeScheduledRun failed (non-fatal)');
  }
}
```

`deliver()` resolves `task.delivery.type`, short-circuits on `'none'`, records a `notification`
failure event when no adapter is registered or the adapter lacks `sendScheduledNotification`, and
otherwise calls it inside try/catch — recording sent/failed either way. Use
`getRunService().appendEvent(run, { eventType: 'notification', node: 'scheduled_notifier', ... })`.
For `delivery.type === 'email'`, call the existing email integration's send path rather than the
connector registry.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd libs/claw-studio && bunx vitest run src/scheduler/scheduled-notifier.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/gateway/types.ts libs/claw-studio/src/scheduler/scheduled-notifier.ts libs/claw-studio/src/scheduler/scheduled-notifier.test.ts
git commit -m "feat(claw-studio): add scheduled run source and delivery notifier"
```

---

### Task 6: Tick → run, and the worker sweeper

**Files:**
- Create: `libs/claw-studio/src/scheduler/run-scheduled-task.ts`
- Create: `apps/workers/src/jobs/claw-scheduler/index.ts`
- Create: `apps/workers/src/jobs/claw-scheduler/schema.ts`
- Test: `libs/claw-studio/src/scheduler/run-scheduled-task.test.ts`
- Modify: `apps/workers/src/index.ts` (register + shutdown)
- Modify: `apps/mission-control/lib/queue.ts` (export the tick queue name)

**Interfaces:**
- Consumes: `selectDueTasks`, `ScheduledTaskService`, `tryAcquireLock`, `advanceIntervalAnchor`, `completeOnceTask`, `finalizeScheduledRun`, and the **existing** `executeRun`
- Produces:
  - `function runScheduledTask(input: { tenantId: string; taskId: string; scheduledAt: string; deps: RouterDeps }): Promise<{ skipped: boolean; runId?: string }>`
  - `const CLAW_SCHEDULER_TICK_QUEUE = 'claw-scheduler-tick'`
  - worker `register(boss, executor)`, `sweep(boss)`, `stopSweeper()`, `closeResources()`

**Per spec D8 there is no worker→HTTP hop.** Nucleus POSTs to a web-ui trigger endpoint because its
agent code lives in web-ui; `libs/claw-studio` is directly importable from `apps/workers` (see the
existing `claw-gateway-run` job), so the tick creates and drives the run in-process. This removes a
network hop, the `INTERNAL_API_KEY` shared secret, and a whole class of 401-misconfig failures.

- [ ] **Step 1: Write the failing test**

Create `libs/claw-studio/src/scheduler/run-scheduled-task.test.ts` covering:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('./scheduled-task-service', () => ({ /* … */ }));
vi.mock('../gateway/execute-run', () => ({ executeRun: vi.fn() }));

describe('runScheduledTask', () => {
  it('skips when the lock is already held', async () => { /* tryAcquireLock → false ⇒ { skipped: true }, executeRun not called */ });
  it('skips a task that is not active', async () => { /* status 'paused' ⇒ skipped */ });
  it('creates a run with source "scheduled" and the taskId in trigger', async () => { /* assert create args */ });
  it('uses a per-run thread for sessionMode "isolated"', async () => { /* threadIdForRun */ });
  it('uses the Claw main thread for sessionMode "main"', async () => { /* getOrCreateClawConversation */ });
  it('passes the task approvalMode and allowedTools through', async () => { /* assert resolveClawRuntime/executeRun input */ });
  it('marks a "once" task completed after firing', async () => { /* completeOnceTask called */ });
  it('finalizes the run even when executeRun throws', async () => { /* finalizeScheduledRun still called */ });
});
```

Write each body out fully following the mocking style of the existing
`libs/claw-studio/src/gateway/execute-run.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/scheduler/run-scheduled-task.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `libs/claw-studio/src/scheduler/run-scheduled-task.ts`:

```ts
import { createLogger } from '@chatbot/shared';
import { executeRun } from '../gateway/execute-run';
import { generateRunId, getRunService, threadIdForRun } from '../gateway/run-service';
import { getOrCreateClawConversation } from '../agent/claw-runtime';
import { SCHEDULED_SOURCE, type RouterDeps } from '../gateway/types';
import { finalizeScheduledRun } from './scheduled-notifier';
import { ScheduledTaskService, completeOnceTask, tryAcquireLock } from './scheduled-task-service';

const logger = createLogger('claw-studio:scheduler:run');

export interface RunScheduledTaskInput {
  tenantId: string;
  taskId: string;
  /** Minute-resolution ISO stamp — the lock key, so one due minute runs once. */
  scheduledAt: string;
  deps: RouterDeps;
}

export async function runScheduledTask(
  input: RunScheduledTaskInput,
): Promise<{ skipped: boolean; runId?: string }> {
  const { tenantId, taskId, scheduledAt, deps } = input;
  try {
    if (!(await tryAcquireLock(taskId, scheduledAt))) {
      logger.info({ taskId, scheduledAt }, 'Lock held by another replica — skipping');
      return { skipped: true };
    }

    const svc = new ScheduledTaskService(tenantId);
    const task = await svc.get(taskId);
    if (!task || task.status !== 'active') {
      logger.info({ taskId, status: task?.status ?? 'missing' }, 'Task not active — skipping');
      return { skipped: true };
    }

    const runId = generateRunId();
    const threadId = task.sessionMode === 'main'
      ? (await getOrCreateClawConversation(task.clawId)).threadId
      : threadIdForRun(runId);

    const run = await getRunService().create({
      tenantId,
      runId,
      source: SCHEDULED_SOURCE,
      taskDescription: task.prompt,
      threadId,
      trigger: { taskId: task.taskId, taskName: task.name, scheduledAt },
    });

    logger.info({ taskId, runId, tenantId, sessionMode: task.sessionMode }, 'Scheduled run created');

    try {
      await executeRun({
        runId,
        deps,
        runtimeOverrides: {
          approvalPolicy: { mode: task.approvalMode, allowedTools: task.allowedTools },
          maxIterations: task.maxIterations ?? undefined,
          providerModelId: task.providerModelId ?? undefined,
          promptSurface: 'scheduled',
        },
      });
    } finally {
      const finished = (await getRunService().get(runId)) ?? run;
      await finalizeScheduledRun(finished);
      if (task.scheduleType === 'once') await completeOnceTask(taskId);
    }

    return { skipped: false, runId };
  } catch (error) {
    logger.error({ error, taskId, tenantId }, 'runScheduledTask failed');
    throw error;
  }
}
```

`executeRun` currently takes no `runtimeOverrides`. Adding an **optional** field to `ExecuteRunInput`
and forwarding it to the existing `resolveClawRuntime` call is the one permitted edit to
`execute-run.ts` — additive, defaulted, and covered by the regression tests from Task 4. Thread the
same fields through `ResolveClawRuntimeInput` → `createClawGraph`.

Then create the worker job. `apps/workers/src/jobs/claw-scheduler/index.ts` ports nucleus's sweeper:
single `CLAW_SCHEDULER_TICK_QUEUE`, `sweepInFlight` guard, `setInterval` at
`env.CLAW_SCHEDULER_SWEEP_MS`, `boss.send` per due task with
`singletonKey: \`task:${taskId}\``/`singletonSeconds: 60`/`retryLimit: 0`, `advanceIntervalAnchor`
right after enqueue for interval tasks, and a `work()` handler that calls `runScheduledTask`.

**`retryLimit: 0` is deliberate**, matching `enqueueGatewayRun`: a scheduled run that failed halfway
may already have sent email or mutated external state, so replaying it could duplicate side effects.
Failures surface on the run record and via `failureStreak`.

Register it in `apps/workers/src/index.ts` beside `claw-gateway-run`, and call `stopSweeper()` at the
**start** of shutdown (before `boss.stop()`) then `closeResources()` after — mirroring nucleus.

- [ ] **Step 4: Run tests, typecheck both projects**

Run:
```bash
cd libs/claw-studio && bunx vitest run && bunx tsc --noEmit -p tsconfig.json
cd ../../apps/workers && bunx tsc --noEmit
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/scheduler apps/workers/src/jobs/claw-scheduler apps/workers/src/index.ts libs/claw-studio/src/gateway/execute-run.ts libs/claw-studio/src/agent/claw-runtime.ts
git commit -m "feat(claw-studio): drive scheduled runs from a single pg-boss sweeper"
```

---

### Task 7: Mission Control API routes

**Files:**
- Create: `apps/mission-control/app/api/scheduled-tasks/route.ts`
- Create: `apps/mission-control/app/api/scheduled-tasks/[taskId]/route.ts`
- Create: `apps/mission-control/app/api/scheduled-tasks/[taskId]/trigger/route.ts`
- Create: `apps/mission-control/app/api/scheduled-tasks/[taskId]/runs/route.ts`
- Create: `apps/mission-control/app/api/scheduled-tasks/distill/route.ts`
- Create: `apps/mission-control/app/api/scheduled-tasks/grantable-tools/route.ts`
- Modify: `libs/claw-studio/src/index.ts` (export the scheduler surface)

**Interfaces:**
- Consumes: `ScheduledTaskService`, `validateSchedule`, `resolveClawForSession` (D1 Task 8)
- Produces: `{ success, data }` / `{ success, error }` responses matching the existing convention

- [ ] **Step 1: Export the scheduler surface from the lib**

Add to `libs/claw-studio/src/index.ts`:

```ts
export {
  ScheduledTaskService, generateTaskId, validateSchedule, computeNextRunAt,
  listAllActiveTasks, advanceIntervalAnchor, tryAcquireLock, completeOnceTask,
  TaskLimitError, InvalidScheduleError, FAILURE_STREAK_LIMIT,
} from './scheduler/scheduled-task-service';
export { selectDueTasks, DUE_WINDOW_MS } from './scheduler/select-due-tasks';
export { runScheduledTask } from './scheduler/run-scheduled-task';
export { finalizeScheduledRun, mapRunStatusToOutcome } from './scheduler/scheduled-notifier';
export type {
  ActiveTaskRow, ScheduledTaskRecord, ScheduleType, TaskStatus,
  ApprovalMode, SessionMode, TaskDelivery, DeliveryChannel,
} from './scheduler/types';
```

- [ ] **Step 2: Write the CRUD routes**

`route.ts` — `GET` lists via `svc.list()`; `POST` validates with a Zod schema mirroring
`CreateTaskInput`, maps `InvalidScheduleError` → 400 and `TaskLimitError` → 409, else 500.

`[taskId]/route.ts` — `GET`, `PATCH` (name/prompt/schedule/status/approvalMode/allowedTools/
sessionMode/delivery; pause and resume are just `{ status }`), `DELETE`.

`[taskId]/trigger/route.ts` — `POST` enqueues an immediate tick using the current minute as
`scheduledAt`, so run-now shares the same lock path as a scheduled fire. Return the `runId`.

`[taskId]/runs/route.ts` — `GET` returns runs where `trigger.taskId === taskId`, newest first, via
the existing run service.

Every handler: Zod at the boundary, try/catch, Pino with `{ tenantId, taskId }`.

- [ ] **Step 3: Write the distill and grantable-tools routes**

`distill/route.ts` — port nucleus's `scheduled-tasks/distill/route.ts` prompt **verbatim** (its rules
are exactly right for unattended runs: keep concrete identifiers, rewrite time windows as relative to
run time, never ask a clarifying question, state the no-op case explicitly). Adapt the model call to
this repo's `LlmProviderService` + `createClawModel`. Keep `MAX_TRANSCRIPT_CHARS = 600_000` and the
413 response. Extend the returned JSON with `suggestedTools: string[]`, instructing the model to list
the mutative tool names it saw in `TOOL_CALL` blocks — that is what pre-checks the grant boxes.

`grantable-tools/route.ts` — `GET` resolves the runtime's tool list for the tenant, filters to
mutative via `classifyTool`, and returns `[{ name, label, integration }]` for the picker. Derive
`label`/`integration` from the integration descriptors; fall back to a humanised tool name for MCP
tools.

- [ ] **Step 4: Typecheck**

Run: `cd apps/mission-control && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mission-control/app/api/scheduled-tasks libs/claw-studio/src/index.ts
git commit -m "feat(mission-control): add scheduled tasks API routes"
```

---

### Task 8: The Cron Jobs UI

**Files:**
- Create: `apps/mission-control/hooks/use-scheduled-tasks.ts`
- Create: `apps/mission-control/components/cron/cron-picker.tsx`
- Create: `apps/mission-control/components/cron/tool-grant-picker.tsx`
- Create: `apps/mission-control/components/cron/scheduled-task-dialog.tsx`
- Create: `apps/mission-control/components/cron/scheduled-tasks-client.tsx`
- Create: `apps/mission-control/app/(console)/cron/page.tsx`
- Create: `apps/mission-control/app/(console)/cron/[taskId]/page.tsx`
- Create: `apps/mission-control/components/cron/task-detail-client.tsx`
- Modify: `apps/mission-control/lib/nav-config.ts`

**Interfaces:**
- Consumes: the Task 7 routes
- Produces: `/cron` list + create/edit dialog + `/cron/[taskId]` detail with run history

**Read `components/skills/skills-client.tsx` and `components/skills/skill-form-dialog.tsx` before
writing anything here and mirror them.** Re-read the *Mission Control UI Conventions* section in the
D1 plan. Getting this wrong is the most likely failure mode of this task.

- [ ] **Step 1: Port the cron picker**

Create `apps/mission-control/components/cron/cron-picker.tsx` from nucleus
`components/agent-ops/cron-picker.tsx`. Keep its structure exactly: a preset `Select`
(`Every hour` / `Daily at 9am` / `Weekdays at 9am` / `Weekly Monday 8am` / `Custom`), a timezone
`Select`, a `font-mono` `Input` shown only when `Custom` is selected, and a live human-readable line
from a lazily-imported `cronstrue` with `throwExceptionOnParseError: true`, rendered in
`text-destructive` when invalid.

Two adaptations: add `Asia/Kolkata` at the **top** of the timezone list (it is the primary timezone in
use — see the reference screenshots), and add a `Daily at 10am` preset.

- [ ] **Step 2: Add the two missing shadcn primitives, then build the tool-grant picker**

**Verified gap:** `apps/mission-control/components/ui/` contains 27 components but **no `checkbox.tsx`
and no `radio-group.tsx`**. The picker needs both, so add them first:

```bash
cd apps/mission-control && bunx shadcn@latest add checkbox radio-group
```

If the CLI's output does not match this project's existing component style, hand-write them instead
following `switch.tsx` — it is the closest existing Radix-based primitive, and matching it keeps the
`cn()` usage, `data-slot` attributes, and class conventions consistent. Verify `components.json` paths
resolve to `components/ui/` before running the CLI, and check the generated files import from
`@/lib/utils` like the rest.

Also check the `new-component` project skill (`.claude/skills/`) — it scaffolds components in this
repo's exact shadcn/Radix/CVA pattern and is the preferred route if the CLI output diverges.

Then create `apps/mission-control/components/cron/tool-grant-picker.tsx`. It fetches
`/api/scheduled-tasks/grantable-tools`, groups by integration, and renders one `Checkbox` per mutative
tool with the friendly label plus the raw tool name in `text-xs text-muted-foreground`. Above the list,
three `RadioGroup` options bound to `approvalMode`: `Ask me for everything` (default), `Allow only
what's checked above`, `Allow everything` — the last with a lucide `AlertTriangle` and the text
"unattended, no prompts". The checkbox list is disabled unless `allowlist` is selected.

Header copy, which is what makes the setting legible:

> **Allowed without asking** — Runs on schedule with nobody watching. Anything not listed here pauses
> the run and notifies you.

- [ ] **Step 3: Build the dialog, list, and detail pages**

`scheduled-task-dialog.tsx` — shadcn `Dialog` + `Form` + Zod resolver, mirroring
`skill-form-dialog.tsx`. Fields: name `Input`; prompt `Textarea` (rows 8); schedule-type `Select`
(cron / interval / once) switching between `<CronPicker>`, an interval-minutes `Input` (min from the
API's floor error), and a `datetime-local` `Input`; `sessionMode` `Select` with help text ("Isolated —
fresh context each run, best for reports" / "Main — remembers previous runs, best for reminders");
delivery channel `Select` + target `Input`; `<ToolGrantPicker>`. Accepts an optional `draft` prop to
prefill from distillation.

`scheduled-tasks-client.tsx` — the heading block, a `New scheduled task` button, and a `DataTable`
with `ColumnDef` columns: Name (name + truncated prompt in `text-xs text-muted-foreground`, matching
the Skills name cell), Schedule (`cronstrue` label + timezone), Next run, Last run
(+ `RunStatusBadge`, reused from `components/runs/`), Status (`Switch` + status word), and a row
`DropdownMenu` (Run now / Edit / Delete) using `render={<Button .../>}`.

`task-detail-client.tsx` + `/cron/[taskId]/page.tsx` — task summary plus a run-history table whose
rows link to the existing `/runs/[runId]` timeline. No new timeline UI.

`/cron/page.tsx` — thin, no heading:

```tsx
import { ScheduledTasksClient } from '@/components/cron/scheduled-tasks-client';

export default function CronPage() {
  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <ScheduledTasksClient />
    </div>
  );
}
```

In `lib/nav-config.ts`, add `Clock` to the lucide import and this to `clawStudioNav`, before `Runs`:

```ts
  { name: 'Cron Jobs', href: '/cron', icon: Clock, enabled: true },
```

- [ ] **Step 4: Verify against the live app**

1. `/cron` renders with the same heading size, spacing, and table chrome as `/skills` — open both side
   by side and compare.
2. Create a task: `Daily at 10am`, `Asia/Kolkata`, prompt "Report the current time and say hello",
   delivery `none`, `Ask me for everything`. The cron line reads "At 10:00 AM".
3. `Run now` → a run appears at `/runs` with source `scheduled`; the timeline renders.
4. Toggle the Switch → status flips to paused; `Next run` clears.
5. Create a task whose prompt sends email, grant only `gmail_send_message`, `Run now` → it sends
   without pausing. Change to `Ask me for everything`, run again → it pauses at the gate.
6. Try `* * * * *` → the API rejects it with the cadence-floor message and the dialog shows it.

Run: `cd apps/mission-control && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mission-control/hooks/use-scheduled-tasks.ts apps/mission-control/components/cron apps/mission-control/app/\(console\)/cron apps/mission-control/lib/nav-config.ts
git commit -m "feat(mission-control): add Cron Jobs UI with per-task tool grants"
```

---

### Task 9: "Schedule this" from chat, and scheduling tools

**Files:**
- Modify: `apps/mission-control/components/chat/chat-client.tsx` (add one button)
- Create: `libs/claw-studio/src/scheduler/schedule-tools.ts`
- Test: `libs/claw-studio/src/scheduler/schedule-tools.test.ts`
- Modify: `libs/claw-studio/src/agent/claw-runtime.ts` (splice the tools)
- Modify: `libs/claw-studio/src/index.ts`

**Interfaces:**
- Consumes: `ScheduledTaskService` (Task 3); the distill route (Task 7)
- Produces:
  - `function createScheduleTools(tenantId: string, opts?: { service?: ScheduledTaskService }): StructuredTool[]`
  - Tools: `create_scheduled_task`, `list_scheduled_tasks`, `update_scheduled_task`, `delete_scheduled_task`

This is what makes cron feel alive: *"email me a Jira report every day at 10am"* in chat creates the
task instead of pointing at a settings page. `create_scheduled_task` matches `/\bcreate\b/i` so it is
approval-gated automatically — no `tool-classifier.ts` change.

- [ ] **Step 1: Write the failing test**

Create `libs/claw-studio/src/scheduler/schedule-tools.test.ts` covering: `create_scheduled_task`
returns a confirmation containing the human cadence; an invalid cron returns a helpful string rather
than throwing; the per-tenant cap returns a message rather than throwing; `list_scheduled_tasks`
renders name + cadence + next run; `delete_scheduled_task` on an unknown id returns a not-found
message. Follow the tool-testing style of `libs/claw-studio/src/agent/file-tools.test.ts` from D2.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/scheduler/schedule-tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `libs/claw-studio/src/scheduler/schedule-tools.ts` with LangChain `tool()` definitions and Zod
schemas. As in D2, **tools must never throw** — `InvalidScheduleError` and `TaskLimitError` become
readable strings the model can act on.

`create_scheduled_task` schema: `name`, `prompt`, `cronExpression`, `timezone` (default `UTC`),
optional `deliveryType` + `deliveryTarget`, optional `allowedTools: string[]`. Its description must
tell Claw to write the prompt as a standalone unattended instruction — no references to "our
conversation", no clarifying questions, time windows relative to run time — the same rules the distill
prompt enforces.

Splice into `claw-runtime.ts`'s tool array after `fileTools.tools`, and export from `index.ts`.

- [ ] **Step 4: Add the chat button**

In `chat-client.tsx`, add a `Schedule this` button (lucide `CalendarClock`, `w-4 h-4 mr-1`) to the
existing header actions, enabled only when the thread has at least one assistant message. On click:
serialize the thread to a transcript, `POST /api/scheduled-tasks/distill`, then open
`<ScheduledTaskDialog draft={...} />` prefilled with the returned `name`, `prompt`,
`suggestedCron`, and `suggestedTools` (grant boxes pre-checked, `approvalMode` preset to
`allowlist`). Show a `Loader2` spinner while distilling and `toast.error("Couldn't build a task",
{ description })` on failure.

- [ ] **Step 5: Verify and commit**

Verify end to end: in `/chat` ask Claw to check something concrete, then click `Schedule this` — the
dialog opens with a standalone recurring prompt, a sensible cron, and the tools it used pre-checked.
Save, then confirm it appears at `/cron`. Separately, tell Claw *"remind me every weekday at 9am to
review the board"* and confirm it calls `create_scheduled_task` and asks for approval first.

Run:
```bash
cd libs/claw-studio && bunx vitest run
cd ../../apps/mission-control && bunx tsc --noEmit
```
Expected: PASS.

```bash
git add libs/claw-studio/src/scheduler/schedule-tools.ts libs/claw-studio/src/scheduler/schedule-tools.test.ts libs/claw-studio/src/agent/claw-runtime.ts libs/claw-studio/src/index.ts apps/mission-control/components/chat/chat-client.tsx
git commit -m "feat(claw-studio): schedule tasks from chat via distillation and tools"
```

---

### Task 10: Learn-on-block — "Always allow for this task"

**Files:**
- Modify: `libs/claw-studio/src/gateway/notification-router.ts` (handle the new action)
- Modify: `libs/claw-studio/src/connectors/adapters/slack.ts` (add the third button)
- Modify: `apps/mission-control/app/api/runs/[runId]/action/route.ts` (accept the action)
- Test: `libs/claw-studio/src/gateway/notification-router.test.ts` (extend)

**Interfaces:**
- Consumes: `'approve_always'` on `ReplyAction` (Task 5); `svc.grantTool` (Task 3)
- Produces: approving *and* persisting the grant, so the task stops asking

This is what keeps grants minimal without requiring the user to predict the tool list up front.

- [ ] **Step 1: Write the failing test**

Extend `notification-router.test.ts`: an `approve_always` action on a run whose
`trigger.taskId` is set must call `grantTool(taskId, toolName)` for each pending tool **and** resume
the run exactly as `approve` does. On a run with no `taskId` (e.g. a Slack-triggered run) it must fall
back to plain `approve` without touching any task.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/gateway/notification-router.test.ts`
Expected: FAIL — action unhandled.

- [ ] **Step 3: Implement**

In the router's action handling, treat `approve_always` as `approve` plus: read
`run.trigger.taskId`; if present, `await new ScheduledTaskService(run.tenantId).grantTool(taskId, name)`
for each name in `run.approvalRequest.pendingTools`. Log at info with `{ taskId, tools }`.

Add the button to the Slack adapter's approval blocks as a third action with `action_id`
`SLACK_APPROVE_ALWAYS_ACTION`, text `Always allow for this task`, shown **only** when
`run.source === SCHEDULED_SOURCE`. Export the new constant alongside the existing
`SLACK_APPROVE_ACTION` / `SLACK_REJECT_ACTION`. Telegram and Discord can follow later; do not change
them here.

Accept `approve_always` in the dashboard action route's Zod enum.

- [ ] **Step 4: Verify and commit**

Run: `cd libs/claw-studio && bunx vitest run`
Expected: PASS.

```bash
git add libs/claw-studio/src/gateway/notification-router.ts libs/claw-studio/src/gateway/notification-router.test.ts libs/claw-studio/src/connectors/adapters/slack.ts apps/mission-control/app/api/runs/\[runId\]/action/route.ts
git commit -m "feat(claw-studio): add 'always allow for this task' approval action"
```

---

### Task 11: Docs and full verification

**Files:**
- Modify: `libs/claw-studio/CLAUDE.md`
- Modify: `CLAUDE.md` (root — add the new worker job and env vars)

- [ ] **Step 1: Document the module**

Add a `## Scheduled Tasks (cron)` section to `libs/claw-studio/CLAUDE.md` covering: the module split
(`scheduler/select-due-tasks.ts` pure, `scheduled-task-service.ts` CRUD+guards,
`run-scheduled-task.ts` tick→run, `scheduled-notifier.ts` delivery, worker = pg-boss wiring only);
**why one sweeper, not per-task pg-boss schedules** (per-task cron forces one queue and one poller per
task — N indexed SELECTs/second doing nothing, plus a consumer leak on delete; nucleus hit and fixed
this); the `approvalPolicy` least-privilege model and why blanket `autoApprove` is wrong for
unattended runs; `retryLimit: 0` and why replaying a partially-completed run is unsafe; the guards
(`CLAW_MIN_INTERVAL_MINUTES`, `CLAW_MAX_ACTIVE_TASKS_PER_TENANT`, `FAILURE_STREAK_LIMIT`); and that
`executeRun` was deliberately left source-agnostic so a scheduled run is just another `ClawRun`.

Add the new env vars to the root `CLAUDE.md` optional-env list and note `bun run dev:workers` now also
runs the scheduler sweeper.

- [ ] **Step 2: Run the full verification gate**

```bash
cd libs/claw-studio && bunx vitest run && bunx tsc --noEmit -p tsconfig.json
cd ../../apps/mission-control && bunx tsc --noEmit
cd ../workers && bunx tsc --noEmit
cd ../.. && bun run test
```
Expected: all PASS, no new failures versus the pre-effort baseline of 443.

- [ ] **Step 3: Confirm the protected modules were untouched**

```bash
git diff --stat main...HEAD -- \
  libs/claw-studio/src/integrations \
  libs/claw-studio/src/memory \
  libs/claw-studio/src/skills \
  libs/claw-studio/src/mcp \
  libs/claw-studio/src/agent/tool-classifier.ts \
  libs/claw-studio/src/connectors/adapters/telegram.ts \
  libs/claw-studio/src/connectors/adapters/discord.ts
```
Expected: **empty output**. Any output means a protected module was modified — revert it.

- [ ] **Step 4: Soak the sweeper**

Start `bun run dev:workers`, create an interval task at the 15-minute floor with delivery `none`, and
watch two consecutive fires. Confirm: exactly one run per fire (no duplicates), `nextRunAt` advances,
`runCount` increments, and the sweeper logs one line per sweep with no error spam. Then stop the
worker mid-run and confirm it shuts down without an unhandled rejection.

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/CLAUDE.md CLAUDE.md
git commit -m "docs(claw-studio): document the scheduled task subsystem"
```

---

## Verification checklist

- [ ] `cd libs/claw-studio && bunx vitest run` — green, only additions vs baseline
- [ ] `bunx tsc --noEmit` clean in `libs/claw-studio`, `apps/mission-control`, `apps/workers`
- [ ] `bun run test` — no new failures
- [ ] **REGRESSION: `autoApprove: true` behaves exactly as `mode: 'all'`** (pinned by test)
- [ ] **REGRESSION: omitting `approvalPolicy` gates mutative tools as before** (pinned by test)
- [ ] Sending an email from `/chat` still prompts for approval
- [ ] Slack/Telegram/Discord runs still work end to end, HIL buttons included
- [ ] A cron task fires within its due minute, in its own timezone
- [ ] Two worker replicas produce exactly one run per due minute (lock works)
- [ ] `* * * * *` is rejected by the cadence floor
- [ ] A task with `allowedTools: ['gmail_send_message']` sends unattended; the same task on `ask` pauses
- [ ] Three consecutive failures auto-pause the task and notify
- [ ] A `once` task fires once and flips to `completed`
- [ ] "Schedule this" in chat produces a standalone prompt with tools pre-checked
- [ ] `/cron` is visually indistinguishable in chrome from `/skills`
- [ ] `checkbox.tsx` and `radio-group.tsx` now exist in `components/ui/` and match `switch.tsx`'s style
- [ ] `git diff --stat` shows no changes to protected modules
