/**
 * run-service.ts — persistence for gateway runs and their event timeline.
 *
 * Every write is tenant-scoped. `runId` is a globally unique unguessable token
 * because it travels in Slack/Telegram button payloads (where the only thing
 * proving the caller's identity is the platform signature, not a session) and in
 * dashboard URLs.
 */

import crypto from 'crypto';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import {
  CHAT_SOURCE,
  RUN_TTL_DAYS,
  type ApprovalRequest,
  type ClawRunEventRecord,
  type ClawRunRecord,
  type RunEventType,
  type RunResult,
  type RunSource,
  type RunStatus,
} from './types';

const logger = createLogger('claw-studio:gateway:runs');

export function generateRunId(): string {
  return `run_${crypto.randomBytes(16).toString('base64url')}`;
}

/** Per-run checkpoint thread. Never the tenant's shared chat thread — two
 *  concurrent gateway runs on one thread would overwrite each other's state. */
export function threadIdForRun(runId: string): string {
  return `claw_run_${runId}`;
}

function ttl(): Date {
  return new Date(Date.now() + RUN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

type RunRow = {
  id: string;
  tenantId: string;
  runId: string;
  source: string;
  status: string;
  taskDescription: string;
  threadId: string;
  trigger: unknown;
  result: unknown;
  clarification: unknown;
  approvalRequest: unknown;
  error: string | null;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

function toRecord(row: RunRow): ClawRunRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    runId: row.runId,
    source: row.source as RunSource,
    status: row.status as RunStatus,
    taskDescription: row.taskDescription,
    threadId: row.threadId,
    trigger: (row.trigger ?? {}) as Record<string, unknown>,
    result: (row.result ?? null) as RunResult | null,
    clarification: (row.clarification ?? null) as { question: string } | null,
    approvalRequest: (row.approvalRequest ?? null) as ApprovalRequest | null,
    error: row.error,
    userId: row.userId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

export interface CreateRunInput {
  tenantId: string;
  source: RunSource;
  taskDescription: string;
  trigger: Record<string, unknown>;
  userId?: string;
  /**
   * Overrides the per-run thread `threadIdForRun(runId)` would otherwise
   * generate. The Playground passes its session's own fixed thread here so
   * every turn in that session shares one LangGraph checkpoint, the same way
   * a real conversation would — only the `ClawRun`/event timeline is one row
   * per turn, not the checkpoint.
   */
  threadId?: string;
}

export interface AppendEventInput {
  eventType: RunEventType;
  node?: string;
  content?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolOutput?: string;
  metadata?: Record<string, unknown>;
}

export class ClawRunService {
  async create(input: CreateRunInput): Promise<ClawRunRecord> {
    const db = getPrismaClient();
    try {
      const runId = generateRunId();
      const row = await db.clawRun.create({
        data: {
          tenantId: input.tenantId,
          runId,
          source: input.source,
          status: 'queued',
          taskDescription: input.taskDescription,
          threadId: input.threadId ?? threadIdForRun(runId),
          trigger: input.trigger as object,
          userId: input.userId ?? null,
          expiresAt: ttl(),
        },
      });
      logger.info(
        { tenantId: input.tenantId, runId, source: input.source },
        'Gateway run created',
      );
      return toRecord(row as RunRow);
    } catch (error) {
      logger.error({ error, tenantId: input.tenantId, source: input.source }, 'Failed to create run');
      throw error;
    }
  }

  /** Tenant-scoped when `tenantId` is given. The gateway resume path omits it —
   *  the run id itself is the capability there, and the adapter already
   *  verified the platform signature. */
  async get(runId: string, tenantId?: string): Promise<ClawRunRecord | null> {
    const db = getPrismaClient();
    try {
      const row = await db.clawRun.findUnique({ where: { runId } });
      if (!row) return null;
      if (tenantId && row.tenantId !== tenantId) {
        logger.warn({ runId, tenantId, ownerTenantId: row.tenantId }, 'Run fetched under the wrong tenant — treating as missing');
        return null;
      }
      return toRecord(row as RunRow);
    } catch (error) {
      logger.error({ error, runId }, 'Failed to fetch run');
      throw error;
    }
  }

  async list(input: {
    tenantId: string;
    status?: RunStatus;
    source?: RunSource;
    limit?: number;
    cursor?: string;
  }): Promise<{ runs: ClawRunRecord[]; nextCursor: string | null }> {
    const db = getPrismaClient();
    const take = Math.min(Math.max(input.limit ?? 25, 1), 100);
    try {
      const rows = await db.clawRun.findMany({
        where: {
          tenantId: input.tenantId,
          ...(input.status ? { status: input.status } : {}),
          // Chat turns are runs so a reloaded page can replay them, but there is
          // one per message — listing them by default would bury the scheduled
          // and channel runs this view exists for. Asking for them explicitly
          // (`source: 'chat'`) still works.
          ...(input.source ? { source: input.source } : { source: { not: CHAT_SOURCE } }),
        },
        orderBy: { createdAt: 'desc' },
        take: take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, take);
      return {
        runs: page.map((r) => toRecord(r as RunRow)),
        nextCursor: rows.length > take ? page[page.length - 1].id : null,
      };
    } catch (error) {
      logger.error({ error, tenantId: input.tenantId }, 'Failed to list runs');
      throw error;
    }
  }

  async countsByStatus(tenantId: string): Promise<Record<string, number>> {
    const db = getPrismaClient();
    try {
      const grouped = await db.clawRun.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      });
      return Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
    } catch (error) {
      logger.error({ error, tenantId }, 'Failed to count runs by status');
      throw error;
    }
  }

  async appendEvent(
    run: Pick<ClawRunRecord, 'tenantId' | 'runId'>,
    input: AppendEventInput,
  ): Promise<ClawRunEventRecord> {
    const db = getPrismaClient();
    try {
      const row = await db.clawRunEvent.create({
        data: {
          tenantId: run.tenantId,
          runId: run.runId,
          eventType: input.eventType,
          node: input.node ?? null,
          content: input.content ?? null,
          toolName: input.toolName ?? null,
          // `undefined` rather than `null`: Prisma reads null on a Json? column as
          // the JSON value `null`, which is not the same as "no value".
          toolArgs: (input.toolArgs ?? undefined) as object | undefined,
          toolOutput: input.toolOutput ?? null,
          metadata: (input.metadata ?? undefined) as object | undefined,
          expiresAt: ttl(),
        },
      });
      return {
        id: row.id,
        tenantId: row.tenantId,
        runId: row.runId,
        eventType: row.eventType,
        node: row.node,
        content: row.content,
        toolName: row.toolName,
        toolArgs: row.toolArgs,
        toolOutput: row.toolOutput,
        metadata: row.metadata,
        createdAt: row.createdAt,
      };
    } catch (error) {
      logger.error({ error, runId: run.runId, eventType: input.eventType }, 'Failed to append run event');
      throw error;
    }
  }

  /**
   * `afterId` returns only the events recorded after that one, so a viewer that
   * is polling a live run fetches each event once instead of the whole timeline
   * every tick. Cursor pagination on the row's own id, with `id` as a secondary
   * sort: several events are written within the same millisecond, and a
   * `createdAt`-only cursor either skips or repeats the ones that tie.
   *
   * An `afterId` that no longer exists (expired by TTL, wrong run) makes Prisma
   * throw, so it degrades to the full list rather than failing the poll.
   */
  async listEvents(runId: string, tenantId?: string, afterId?: string): Promise<ClawRunEventRecord[]> {
    const db = getPrismaClient();
    const query = {
      where: { runId, ...(tenantId ? { tenantId } : {}) },
      orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    };
    try {
      let rows;
      try {
        rows = await db.clawRunEvent.findMany({
          ...query,
          ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
        });
      } catch (cursorError) {
        if (!afterId) throw cursorError;
        logger.warn(
          { runId, afterId },
          'Run event cursor no longer exists — returning the full timeline instead',
        );
        rows = await db.clawRunEvent.findMany(query);
      }
      return rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        runId: row.runId,
        eventType: row.eventType,
        node: row.node,
        content: row.content,
        toolName: row.toolName,
        toolArgs: row.toolArgs,
        toolOutput: row.toolOutput,
        metadata: row.metadata,
        createdAt: row.createdAt,
      }));
    } catch (error) {
      logger.error({ error, runId }, 'Failed to list run events');
      throw error;
    }
  }

  /**
   * Every run on a thread, oldest first — one per turn of the conversation.
   *
   * This is what lets a reloaded chat show the process behind ANY past answer, not
   * just the latest: the client holds a `runId` per assistant message and needs
   * each turn's status and metrics without issuing one request per message.
   * Deliberately excludes `events`, which are fetched per run on demand — a long
   * conversation's full timeline is far too much to send just to label the turns.
   */
  async listByThread(threadId: string, tenantId: string): Promise<ClawRunRecord[]> {
    const db = getPrismaClient();
    try {
      const rows = await db.clawRun.findMany({
        where: { threadId, tenantId },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((row) => toRecord(row as RunRow));
    } catch (error) {
      logger.error({ error, threadId, tenantId }, 'Failed to list runs for a thread');
      throw error;
    }
  }

  /**
   * The most recent run on a LangGraph thread, whatever its status.
   *
   * This is how a reloaded browser finds the turn it was watching: the page knows
   * its chat session (and therefore its thread) but not the run id, which only
   * ever existed in the SSE stream it just lost. Returning the latest run rather
   * than only a live one lets the client cover both cases with one request — the
   * turn is still going, or it finished while the page was away and the answer is
   * sitting in `result`.
   *
   * Tenant-scoped. Chat threads are sequential by construction (the UI blocks a
   * send while `isStreaming`), so "latest on this thread" is unambiguous.
   */
  async findLatestByThread(threadId: string, tenantId: string): Promise<ClawRunRecord | null> {
    const db = getPrismaClient();
    try {
      const row = await db.clawRun.findFirst({
        where: { threadId, tenantId },
        orderBy: { createdAt: 'desc' },
      });
      return row ? toRecord(row as RunRow) : null;
    } catch (error) {
      logger.error({ error, threadId, tenantId }, 'Failed to find the latest run for a thread');
      throw error;
    }
  }

  /**
   * Finds the most recent run whose `trigger` JSON has `path` equal to `value`.
   *
   * This is how a free-text reply gets attached to the run it answers: Slack
   * gives us a `thread_ts`, Telegram a `chat_id`, and neither carries a run id.
   * Scoped to the tenant and to the statuses that can actually consume a reply.
   */
  async findByTriggerField(input: {
    tenantId: string;
    source: RunSource;
    path: string[];
    value: string | number;
    statuses: RunStatus[];
  }): Promise<ClawRunRecord | null> {
    const db = getPrismaClient();
    try {
      const row = await db.clawRun.findFirst({
        where: {
          tenantId: input.tenantId,
          source: input.source,
          status: { in: input.statuses as string[] },
          trigger: { path: input.path, equals: input.value },
        },
        orderBy: { createdAt: 'desc' },
      });
      return row ? toRecord(row as RunRow) : null;
    } catch (error) {
      logger.error(
        { error, tenantId: input.tenantId, source: input.source, path: input.path },
        'Failed to find run by trigger field',
      );
      return null;
    }
  }

  /** Cheap status probe — used by the worker between graph steps to notice an
   *  out-of-process cancel. */
  async getStatus(runId: string): Promise<RunStatus | null> {
    const db = getPrismaClient();
    try {
      const row = await db.clawRun.findUnique({ where: { runId }, select: { status: true } });
      return (row?.status as RunStatus) ?? null;
    } catch (error) {
      logger.error({ error, runId }, 'Failed to read run status');
      return null;
    }
  }

  private async update(runId: string, data: Record<string, unknown>): Promise<ClawRunRecord> {
    const db = getPrismaClient();
    try {
      const row = await db.clawRun.update({ where: { runId }, data });
      return toRecord(row as RunRow);
    } catch (error) {
      logger.error({ error, runId, fields: Object.keys(data) }, 'Failed to update run');
      throw error;
    }
  }

  setStatus(runId: string, status: RunStatus): Promise<ClawRunRecord> {
    return this.update(runId, { status });
  }

  markInProgress(runId: string): Promise<ClawRunRecord> {
    return this.update(runId, { status: 'in_progress', error: null });
  }

  markCompleted(runId: string, result: RunResult): Promise<ClawRunRecord> {
    return this.update(runId, {
      status: 'completed',
      result: result as object,
      clarification: null,
      approvalRequest: null,
      completedAt: new Date(),
    });
  }

  markFailed(runId: string, error: string): Promise<ClawRunRecord> {
    return this.update(runId, { status: 'failed', error, completedAt: new Date() });
  }

  markCancelled(runId: string, reason?: string): Promise<ClawRunRecord> {
    return this.update(runId, {
      status: 'cancelled',
      error: reason ?? null,
      approvalRequest: null,
      clarification: null,
      completedAt: new Date(),
    });
  }

  markAwaitingInput(runId: string, question: string): Promise<ClawRunRecord> {
    return this.update(runId, {
      status: 'awaiting_input',
      clarification: { question },
      approvalRequest: null,
    });
  }

  markAwaitingApproval(runId: string, request: ApprovalRequest): Promise<ClawRunRecord> {
    return this.update(runId, {
      status: 'awaiting_approval',
      approvalRequest: request as object,
      clarification: null,
    });
  }

  /** Merges keys into `trigger` — adapters use this to remember an outbound
   *  message id (Telegram's ack message, Slack's posted ts) for later edits. */
  async mergeTrigger(runId: string, patch: Record<string, unknown>): Promise<void> {
    const db = getPrismaClient();
    try {
      const row = await db.clawRun.findUnique({ where: { runId }, select: { trigger: true } });
      const merged = { ...((row?.trigger ?? {}) as Record<string, unknown>), ...patch };
      await db.clawRun.update({ where: { runId }, data: { trigger: merged as object } });
    } catch (error) {
      // Losing a message-id hint degrades later edits to new messages; it must
      // never fail the run.
      logger.warn({ error, runId, keys: Object.keys(patch) }, 'Failed to merge run trigger metadata');
    }
  }
}

const g = globalThis as typeof globalThis & { _clawRunService?: ClawRunService };

export function getRunService(): ClawRunService {
  if (!g._clawRunService) g._clawRunService = new ClawRunService();
  return g._clawRunService;
}
