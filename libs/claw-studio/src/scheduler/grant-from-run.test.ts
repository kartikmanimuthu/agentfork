import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRun = vi.fn();
const grantTool = vi.fn();

vi.mock('../gateway/run-service', () => ({
  getRunService: () => ({ get: getRun }),
}));

vi.mock('./scheduled-task-service', () => ({
  ScheduledTaskService: class {
    grantTool = grantTool;
  },
}));

const { grantPendingToolsForRun } = await import('./grant-from-run');

const scheduledRun = (over: Record<string, unknown> = {}) => ({
  runId: 'run-1',
  tenantId: 't1',
  source: 'scheduled',
  trigger: { taskId: 'task-1' },
  approvalRequest: { kind: 'tool', pendingTools: ['gmail_send_message'] },
  ...over,
});

describe('grantPendingToolsForRun', () => {
  beforeEach(() => {
    getRun.mockReset();
    grantTool.mockReset();
  });

  it('grants each pending tool to the originating task', async () => {
    getRun.mockResolvedValue(scheduledRun({
      approvalRequest: { kind: 'tool', pendingTools: ['gmail_send_message', 'notion_create_page'] },
    }));

    const result = await grantPendingToolsForRun('run-1');

    expect(result.granted).toEqual(['gmail_send_message', 'notion_create_page']);
    expect(grantTool).toHaveBeenCalledWith('task-1', 'gmail_send_message', 'run-1');
    expect(grantTool).toHaveBeenCalledWith('task-1', 'notion_create_page', 'run-1');
  });

  it('grants nothing for a channel-triggered run — there is no task', async () => {
    getRun.mockResolvedValue(scheduledRun({ source: 'slack' }));
    const result = await grantPendingToolsForRun('run-1');
    expect(result).toEqual({ granted: [], reason: 'not-scheduled' });
    expect(grantTool).not.toHaveBeenCalled();
  });

  it('grants nothing when the run carries no taskId', async () => {
    getRun.mockResolvedValue(scheduledRun({ trigger: {} }));
    expect((await grantPendingToolsForRun('run-1')).reason).toBe('no-task');
    expect(grantTool).not.toHaveBeenCalled();
  });

  it('grants nothing for a plan approval — there are no tools to grant', async () => {
    getRun.mockResolvedValue(scheduledRun({
      approvalRequest: { kind: 'plan', planSteps: ['do a thing'] },
    }));
    expect((await grantPendingToolsForRun('run-1')).reason).toBe('no-pending-tools');
    expect(grantTool).not.toHaveBeenCalled();
  });

  it('reports a missing run rather than throwing', async () => {
    getRun.mockResolvedValue(null);
    expect((await grantPendingToolsForRun('nope')).reason).toBe('run-missing');
  });

  it('swallows a grant failure so the approval itself still proceeds', async () => {
    getRun.mockResolvedValue(scheduledRun());
    grantTool.mockRejectedValueOnce(new Error('db down'));
    await expect(grantPendingToolsForRun('run-1')).resolves.toEqual({ granted: [] });
  });
});
