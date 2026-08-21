/**
 * notification-router.ts — translates bus events into adapter calls.
 *
 * Knows nothing about any specific platform: it switches on the event and on the
 * adapter's two declared capability flags (`deliveryMode`, `hilCapabilities`).
 * Per the design reference (§3), every adapter call is wrapped so that a broken
 * or unreachable channel logs and moves on — an adapter must never crash the run
 * that is emitting.
 *
 * When a channel can't render a HIL prompt, the fallback is a dashboard link, so
 * the human is never left with a silently stuck run.
 */

import { createLogger } from '@chatbot/shared';
import { getRunEventBus } from './event-bus';
import { getRunService } from './run-service';
import type { BusEvent, ChannelAdapter, ClawRunRecord } from './types';

const logger = createLogger('claw-studio:gateway:router');

export interface RouterDeps {
  /** Absolute origin of Mission Control, for HIL fallback links. */
  dashboardBaseUrl: string;
}

export function runUrl(baseUrl: string, runId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/runs/${runId}`;
}

/**
 * Subscribes an adapter to one run's events. Call BEFORE execution starts so no
 * early event is missed. Returns an unsubscribe closure.
 */
export function attachToRun(
  run: ClawRunRecord,
  adapter: ChannelAdapter,
  deps: RouterDeps,
): () => void {
  const bus = getRunEventBus();
  const runs = getRunService();
  const streams = adapter.deliveryMode === 'streaming' && typeof adapter.sendStreamChunk === 'function';

  /** Latest persisted record — status/trigger change as the run advances, and
   *  adapters read trigger metadata (ack message ids) to edit in place. */
  const current = async (): Promise<ClawRunRecord> => (await runs.get(run.runId)) ?? run;

  const safely = async (label: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (error) {
      logger.error(
        { error, runId: run.runId, channel: adapter.channelType, notification: label },
        'Adapter notification failed — run is unaffected',
      );
    }
  };

  const fallbackToDashboard = (fresh: ClawRunRecord, what: string): Promise<void> =>
    safely('dashboard_fallback', () =>
      adapter.sendError(
        fresh,
        `${what} Open ${runUrl(deps.dashboardBaseUrl, fresh.runId)} to respond.`,
      ),
    );

  return bus.subscribe(run.runId, async (event: BusEvent) => {
    switch (event.name) {
      case 'run:event': {
        if (!streams) return;
        const fresh = await current();
        await safely('stream_chunk', () => adapter.sendStreamChunk!(fresh, event.event));
        return;
      }

      case 'run:completed': {
        const [fresh, events] = await Promise.all([current(), runs.listEvents(run.runId)]);
        await safely('result', () => adapter.sendResult(fresh, events));
        return;
      }

      case 'run:failed': {
        const fresh = await current();
        await safely('error', () => adapter.sendError(fresh, event.error));
        return;
      }

      case 'run:cancelled': {
        const fresh = await current();
        await safely('cancelled', () =>
          adapter.sendError(fresh, event.reason ?? 'Run was cancelled.'),
        );
        return;
      }

      case 'hil:clarification': {
        const fresh = await current();
        if (!adapter.hilCapabilities.clarification) {
          await fallbackToDashboard(fresh, `Claw needs more information: ${event.question}`);
          return;
        }
        await safely('clarification', () => adapter.sendClarification(fresh, event.question));
        return;
      }

      case 'hil:plan_approval':
      case 'hil:tool_approval': {
        const fresh = await current();
        if (!adapter.hilCapabilities.approvalButtons) {
          await fallbackToDashboard(fresh, 'Claw is waiting for your approval.');
          return;
        }
        await safely('approval_request', () => adapter.sendApprovalRequest(fresh, event.request));
        return;
      }
    }
  });
}
