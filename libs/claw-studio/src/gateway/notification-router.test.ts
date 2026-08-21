import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attachToRun, runUrl } from './notification-router';
import { RunEventBus } from './event-bus';
import type { ApprovalRequest, ChannelAdapter, ClawRunRecord, HilCapabilities } from './types';

const bus = new RunEventBus();
const listEvents = vi.fn(async () => []);
const getRun = vi.fn();

vi.mock('./event-bus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./event-bus')>();
  return { ...actual, getRunEventBus: () => bus };
});

vi.mock('./run-service', () => ({
  getRunService: () => ({ get: getRun, listEvents }),
}));

const run: ClawRunRecord = {
  id: 'id1',
  tenantId: 'tenant1',
  runId: 'run_abc',
  source: 'slack',
  status: 'in_progress',
  taskDescription: 'do the thing',
  threadId: 'claw_run_run_abc',
  trigger: {},
  result: null,
  clarification: null,
  approvalRequest: null,
  error: null,
  userId: 'U1',
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
};

function makeAdapter(overrides: {
  deliveryMode?: 'streaming' | 'callback' | 'polling';
  hil?: Partial<HilCapabilities>;
  withStreamChunk?: boolean;
} = {}) {
  const adapter = {
    channelType: 'slack' as const,
    displayName: 'Slack',
    description: '',
    deliveryMode: overrides.deliveryMode ?? 'callback',
    hilCapabilities: {
      clarification: true,
      approvalButtons: true,
      threadedReplies: true,
      ...overrides.hil,
    },
    getConfig: vi.fn(),
    verifyCredentials: vi.fn(),
    validateRequest: vi.fn(),
    parseInbound: vi.fn(),
    sendAck: vi.fn(),
    sendResult: vi.fn(async () => {}),
    sendError: vi.fn(async () => {}),
    sendClarification: vi.fn(async () => {}),
    sendApprovalRequest: vi.fn(async () => {}),
    ...(overrides.withStreamChunk ? { sendStreamChunk: vi.fn(async () => {}) } : {}),
  };
  return adapter as unknown as ChannelAdapter & Record<string, ReturnType<typeof vi.fn>>;
}

const deps = { dashboardBaseUrl: 'https://mc.example.com/' };
const approval: ApprovalRequest = { kind: 'tool', pendingTools: ['delete_file'] };

beforeEach(() => {
  vi.clearAllMocks();
  getRun.mockResolvedValue(run);
  bus.cleanup(run.runId);
});

describe('runUrl', () => {
  it('joins without doubling the slash', () => {
    expect(runUrl('https://mc.example.com/', 'run_abc')).toBe('https://mc.example.com/runs/run_abc');
    expect(runUrl('https://mc.example.com', 'run_abc')).toBe('https://mc.example.com/runs/run_abc');
  });
});

describe('attachToRun', () => {
  it('sends the result with the full event history on completion', async () => {
    const adapter = makeAdapter();
    attachToRun(run, adapter, deps);

    bus.emit({ name: 'run:completed', runId: run.runId });
    await bus.drain(run.runId);

    expect(adapter.sendResult).toHaveBeenCalledTimes(1);
    expect(listEvents).toHaveBeenCalledWith(run.runId);
  });

  it('reads the run back fresh rather than reusing the stale record it was attached with', async () => {
    const adapter = makeAdapter();
    const finished = { ...run, status: 'completed' as const, result: { answer: 'done' } };
    getRun.mockResolvedValue(finished);
    attachToRun(run, adapter, deps);

    bus.emit({ name: 'run:completed', runId: run.runId });
    await bus.drain(run.runId);

    expect(adapter.sendResult).toHaveBeenCalledWith(finished, []);
  });

  it('streams chunks only when the adapter declares streaming delivery', async () => {
    const streaming = makeAdapter({ deliveryMode: 'streaming', withStreamChunk: true });
    const callback = makeAdapter({ deliveryMode: 'callback', withStreamChunk: true });

    attachToRun(run, streaming, deps);
    attachToRun(run, callback, deps);
    bus.emit({
      name: 'run:event',
      runId: run.runId,
      event: { id: 'e1', tenantId: 't', runId: run.runId, eventType: 'tool_call', node: 'generate', content: null, toolName: 'x', toolArgs: null, toolOutput: null, metadata: null, createdAt: new Date() },
    });
    await bus.drain(run.runId);

    expect(streaming.sendStreamChunk).toHaveBeenCalledTimes(1);
    expect(callback.sendStreamChunk).not.toHaveBeenCalled();
  });

  it('routes an approval request to the adapter when it can render buttons', async () => {
    const adapter = makeAdapter();
    attachToRun(run, adapter, deps);

    bus.emit({ name: 'hil:tool_approval', runId: run.runId, request: approval });
    await bus.drain(run.runId);

    expect(adapter.sendApprovalRequest).toHaveBeenCalledWith(run, approval);
    expect(adapter.sendError).not.toHaveBeenCalled();
  });

  it('falls back to a dashboard link when the channel cannot render approvals', async () => {
    const adapter = makeAdapter({ hil: { approvalButtons: false } });
    attachToRun(run, adapter, deps);

    bus.emit({ name: 'hil:plan_approval', runId: run.runId, request: { kind: 'plan', planSteps: ['a'] } });
    await bus.drain(run.runId);

    expect(adapter.sendApprovalRequest).not.toHaveBeenCalled();
    expect(adapter.sendError).toHaveBeenCalledTimes(1);
    expect(adapter.sendError.mock.calls[0][1]).toContain('https://mc.example.com/runs/run_abc');
  });

  it('falls back to a dashboard link when the channel cannot ask follow-up questions', async () => {
    const adapter = makeAdapter({ hil: { clarification: false } });
    attachToRun(run, adapter, deps);

    bus.emit({ name: 'hil:clarification', runId: run.runId, question: 'which one?' });
    await bus.drain(run.runId);

    expect(adapter.sendClarification).not.toHaveBeenCalled();
    expect(adapter.sendError.mock.calls[0][1]).toContain('which one?');
    expect(adapter.sendError.mock.calls[0][1]).toContain('/runs/run_abc');
  });

  it('a throwing adapter is contained — the failure never propagates to the emitter', async () => {
    const adapter = makeAdapter();
    adapter.sendResult.mockRejectedValue(new Error('slack down'));
    attachToRun(run, adapter, deps);

    bus.emit({ name: 'run:completed', runId: run.runId });
    await expect(bus.drain(run.runId)).resolves.toBeUndefined();
  });

  it('reports cancellation with its reason', async () => {
    const adapter = makeAdapter();
    attachToRun(run, adapter, deps);

    bus.emit({ name: 'run:cancelled', runId: run.runId, reason: 'Rejected.' });
    await bus.drain(run.runId);

    expect(adapter.sendError).toHaveBeenCalledWith(run, 'Rejected.');
  });
});
