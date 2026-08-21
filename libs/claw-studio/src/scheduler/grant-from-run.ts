/**
 * grant-from-run.ts — the "always allow for this task" half of learn-on-block.
 *
 * Lives here rather than in the gateway so `execute-run.ts` keeps no dependency on
 * the scheduler module (the scheduler already imports the gateway; the reverse would
 * be circular). The worker handler calls this before resuming the run.
 */

import { createLogger } from '@chatbot/shared';
import { getRunService } from '../gateway/run-service';
import { SCHEDULED_SOURCE } from '../gateway/types';
import { ScheduledTaskService } from './scheduled-task-service';

const logger = createLogger('claw-studio:scheduler:grant-from-run');

export interface GrantFromRunResult {
  granted: string[];
  /** Why nothing was granted, when nothing was. */
  reason?: 'not-scheduled' | 'no-task' | 'no-pending-tools' | 'run-missing';
}

/**
 * Adds the tools a paused run is waiting on to its originating scheduled task's
 * allowlist, so the task stops asking. Never throws — failing to persist a grant
 * must not block the approval itself.
 */
export async function grantPendingToolsForRun(runId: string): Promise<GrantFromRunResult> {
  try {
    const run = await getRunService().get(runId);
    if (!run) return { granted: [], reason: 'run-missing' };

    // A channel-triggered run has no task to grant anything on.
    if (run.source !== SCHEDULED_SOURCE) return { granted: [], reason: 'not-scheduled' };

    const taskId = (run.trigger as { taskId?: string } | null)?.taskId;
    if (!taskId) return { granted: [], reason: 'no-task' };

    const request = run.approvalRequest as { kind?: string; pendingTools?: string[] } | null;
    const pending = request?.kind === 'tool' ? (request.pendingTools ?? []) : [];
    if (pending.length === 0) return { granted: [], reason: 'no-pending-tools' };

    const service = new ScheduledTaskService(run.tenantId);
    for (const toolName of pending) {
      await service.grantTool(taskId, toolName, runId);
    }

    logger.info({ runId, taskId, granted: pending }, 'Granted pending tools to scheduled task');
    return { granted: pending };
  } catch (error) {
    logger.error({ error, runId }, 'Failed to grant pending tools (non-fatal)');
    return { granted: [] };
  }
}
