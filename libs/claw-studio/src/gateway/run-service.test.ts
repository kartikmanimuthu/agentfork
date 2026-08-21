import { describe, it, expect, vi, beforeEach } from 'vitest';

// `@chatbot/shared` is a package import, so vi.mock intercepts it reliably — the
// known limitation in this package is relative-module imports (see CLAUDE.md).
const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    clawRun: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    clawRunEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@chatbot/shared', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  getPrismaClient: () => mockDb,
}));

import { ClawRunService } from './run-service';
import { CHAT_SOURCE } from './types';

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row1', tenantId: 't1', runId: 'run_1', source: CHAT_SOURCE, status: 'in_progress',
    taskDescription: 'hello', threadId: 'claw_thread_1', trigger: {}, result: null,
    clarification: null, approvalRequest: null, error: null, userId: null,
    createdAt: new Date('2026-08-19T10:00:00Z'), updatedAt: new Date('2026-08-19T10:00:00Z'),
    completedAt: null, expiresAt: new Date('2026-09-18T10:00:00Z'), ...overrides,
  };
}

function eventRow(id: string, createdAt: string) {
  return {
    id, tenantId: 't1', runId: 'run_1', eventType: 'tool_call', node: 'agent',
    content: null, toolName: 'search_memory', toolArgs: null, toolOutput: null,
    metadata: null, createdAt: new Date(createdAt),
  };
}

describe('ClawRunService.findLatestByThread', () => {
  beforeEach(() => vi.clearAllMocks());

  // This is how a reloaded browser finds the turn it was watching: it knows its
  // thread but not the run id, which only existed in the SSE stream it just lost.
  it('returns the newest run on the thread, scoped to the tenant', async () => {
    mockDb.clawRun.findFirst.mockResolvedValue(runRow());
    const result = await new ClawRunService().findLatestByThread('claw_thread_1', 't1');

    expect(result?.runId).toBe('run_1');
    expect(mockDb.clawRun.findFirst).toHaveBeenCalledWith({
      where: { threadId: 'claw_thread_1', tenantId: 't1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  // Deliberately not filtered to live runs: the same call has to serve "the turn
  // is still going" and "it finished while the page was away".
  it('returns a completed run too, so a finished answer is still recoverable', async () => {
    mockDb.clawRun.findFirst.mockResolvedValue(
      runRow({ status: 'completed', result: { answer: 'the answer' } }),
    );
    const result = await new ClawRunService().findLatestByThread('claw_thread_1', 't1');
    expect(result?.status).toBe('completed');
    expect(result?.result?.answer).toBe('the answer');
  });

  it('returns null for a thread with no runs', async () => {
    mockDb.clawRun.findFirst.mockResolvedValue(null);
    await expect(new ClawRunService().findLatestByThread('unused', 't1')).resolves.toBeNull();
  });
});

describe('ClawRunService.listEvents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('orders by createdAt then id, so events written in the same millisecond are stable', async () => {
    mockDb.clawRunEvent.findMany.mockResolvedValue([]);
    await new ClawRunService().listEvents('run_1', 't1');
    expect(mockDb.clawRunEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    );
  });

  // The poll cursor: a page following a live turn should fetch each event once.
  it('pages from a cursor when given one', async () => {
    mockDb.clawRunEvent.findMany.mockResolvedValue([eventRow('e3', '2026-08-19T10:00:02Z')]);
    const events = await new ClawRunService().listEvents('run_1', 't1', 'e2');

    expect(events.map((e) => e.id)).toEqual(['e3']);
    expect(mockDb.clawRunEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'e2' }, skip: 1 }),
    );
  });

  // A cursor can expire out from under a poller — the 30-day TTL deletes events —
  // and Prisma throws on a missing cursor. Losing the timeline is worse than
  // re-sending it, so it degrades instead of failing the poll.
  it('falls back to the full timeline when the cursor no longer exists', async () => {
    mockDb.clawRunEvent.findMany
      .mockRejectedValueOnce(new Error('Record to use as cursor not found'))
      .mockResolvedValueOnce([eventRow('e1', '2026-08-19T10:00:00Z'), eventRow('e2', '2026-08-19T10:00:01Z')]);

    const events = await new ClawRunService().listEvents('run_1', 't1', 'gone');
    expect(events.map((e) => e.id)).toEqual(['e1', 'e2']);
    // Second call carries no cursor.
    expect(mockDb.clawRunEvent.findMany).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ cursor: expect.anything() }),
    );
  });

  // Without a cursor there is nothing to degrade to, so a real failure must surface.
  it('still throws when the un-cursored query fails', async () => {
    mockDb.clawRunEvent.findMany.mockRejectedValue(new Error('connection lost'));
    await expect(new ClawRunService().listEvents('run_1', 't1')).rejects.toThrow('connection lost');
  });
});

describe('ClawRunService.list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.clawRun.findMany.mockResolvedValue([]);
  });

  // One run per chat message would bury the scheduled and channel runs the /runs
  // view exists for.
  it('hides chat turns by default', async () => {
    await new ClawRunService().list({ tenantId: 't1' });
    expect(mockDb.clawRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', source: { not: CHAT_SOURCE } } }),
    );
  });

  it('includes them when asked for explicitly', async () => {
    await new ClawRunService().list({ tenantId: 't1', source: CHAT_SOURCE });
    expect(mockDb.clawRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', source: CHAT_SOURCE } }),
    );
  });

  it('does not smuggle the chat exclusion past another source filter', async () => {
    await new ClawRunService().list({ tenantId: 't1', source: 'scheduled' });
    const where = mockDb.clawRun.findMany.mock.calls.at(-1)?.[0]?.where;
    expect(where).toEqual({ tenantId: 't1', source: 'scheduled' });
  });
});
