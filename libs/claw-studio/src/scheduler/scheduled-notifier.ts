/**
 * scheduled-notifier.ts — post-run bookkeeping and outcome delivery for scheduled runs.
 *
 * Ported from nucleus `apps/web-ui/lib/agent-ops/scheduled-notifier.ts`.
 *
 * Never throws: a delivery failure must not abort run finalization. But it is never
 * silent either — every attempt is recorded as a `notification` event on the run, so
 * a missing bot token or a channel that can't do scheduled delivery is visible in
 * the run timeline rather than being swallowed.
 */

import { createLogger } from '@chatbot/shared';
import { getConnectorRegistry } from '../connectors/registry';
import { getRunService } from '../gateway/run-service';
import {
  SCHEDULED_SOURCE,
  type ChannelAdapter,
  type ClawRunRecord,
  type ScheduledOutcome,
} from '../gateway/types';
import type { ChannelType } from '../connectors/types';
import { ScheduledTaskService } from './scheduled-task-service';
import type { ScheduledTaskRecord } from './types';

const logger = createLogger('claw-studio:scheduler:notifier');

export function mapRunStatusToOutcome(status: string): ScheduledOutcome | null {
  switch (status) {
    case 'completed':
      return 'result';
    case 'failed':
    case 'cancelled':
      return 'failure';
    case 'awaiting_input':
    case 'awaiting_approval':
      return 'attention';
    default:
      // queued / in_progress — nothing to report yet.
      return null;
  }
}

async function recordNotification(
  run: ClawRunRecord,
  fields: { status: 'sent' | 'failed'; channel: string; outcome: ScheduledOutcome; taskId: string; error?: string },
): Promise<void> {
  try {
    await getRunService().appendEvent(run, {
      eventType: 'notification',
      node: 'scheduled_notifier',
      content: fields.status === 'sent'
        ? `Scheduled digest delivered via ${fields.channel}`
        : `Scheduled digest delivery via ${fields.channel} failed: ${fields.error}`,
      metadata: { ...fields },
    });
  } catch (error) {
    // Even the audit trail failing must not break finalization.
    logger.error({ error, runId: run.runId }, 'Could not record notification event');
  }
}

async function deliver(task: ScheduledTaskRecord, run: ClawRunRecord): Promise<void> {
  const channel = task.delivery?.type;
  if (!channel || channel === 'none') return;

  const outcome = mapRunStatusToOutcome(run.status);
  if (!outcome) {
    logger.warn({ runId: run.runId, status: run.status }, 'Run status has no digest — skipping delivery');
    return;
  }

  const registry = getConnectorRegistry();
  if (!registry.has(channel)) {
    await recordNotification(run, {
      status: 'failed', channel, outcome, taskId: task.taskId,
      error: `no adapter registered for channel '${channel}'`,
    });
    return;
  }

  const adapter = registry.get(channel as ChannelType) as ChannelAdapter;
  if (!adapter.sendScheduledNotification) {
    await recordNotification(run, {
      status: 'failed', channel, outcome, taskId: task.taskId,
      error: `channel '${channel}' does not support scheduled notifications`,
    });
    return;
  }

  try {
    await adapter.sendScheduledNotification(
      { taskId: task.taskId, name: task.name, delivery: task.delivery },
      run,
      outcome,
    );
    await recordNotification(run, { status: 'sent', channel, outcome, taskId: task.taskId });
    logger.info({ runId: run.runId, channel, outcome }, 'Delivered scheduled digest');
  } catch (error) {
    await recordNotification(run, {
      status: 'failed', channel, outcome, taskId: task.taskId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * No-ops unless this is a scheduled run carrying a taskId. Safe to call with any run.
 */
export async function finalizeScheduledRun(
  run: ClawRunRecord,
  opts?: { countRun?: boolean },
): Promise<void> {
  try {
    if (run.source !== SCHEDULED_SOURCE) return;
    const taskId = (run.trigger as { taskId?: string } | null)?.taskId;
    if (!taskId) return;

    const service = new ScheduledTaskService(run.tenantId);
    const task = await service.get(taskId);
    if (!task) {
      logger.warn({ taskId, runId: run.runId }, 'Scheduled task not found — skipping finalize');
      return;
    }

    if (opts?.countRun ?? true) {
      const { autoPaused } = await service.recordRun(taskId, run.runId, run.status);
      if (autoPaused) {
        logger.warn({ taskId, tenantId: run.tenantId }, 'Task auto-paused after consecutive failures');
      }
    }

    await deliver(task, run);
  } catch (error) {
    logger.error({ error, runId: run.runId }, 'finalizeScheduledRun failed (non-fatal)');
  }
}
