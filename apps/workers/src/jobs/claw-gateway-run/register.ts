import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { handleClawGatewayRun } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('claw-gateway-run-register');
export const CLAW_GATEWAY_RUN_QUEUE = 'claw-gateway-run';

/**
 * Batched fetch, but the jobs in a batch run CONCURRENTLY rather than in
 * sequence — a Claw run takes minutes, so processing a batch serially would let
 * one tenant's long task hold up everyone else's.
 *
 * Failures are settled per job instead of thrown: a rejection would fail every
 * other job in the same batch, and the run's real outcome is already recorded on
 * ClawRun.status by the handler, which is the source of truth the UI and the
 * channel both read.
 */
export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  if (executor.registerHandler) {
    executor.registerHandler(CLAW_GATEWAY_RUN_QUEUE, handleClawGatewayRun);
  }

  await boss.createQueue(CLAW_GATEWAY_RUN_QUEUE);
  await boss.work(CLAW_GATEWAY_RUN_QUEUE, { batchSize: 3 }, async (jobs) => {
    const results = await Promise.allSettled(
      jobs.map(async (job) => {
        log.info('Processing gateway run job', { jobId: job.id });
        await executor.execute(CLAW_GATEWAY_RUN_QUEUE, job.data);
      }),
    );

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        log.error('Gateway run job failed', {
          jobId: jobs[index]?.id,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
  });

  log.info('Registered job handler', { jobName: CLAW_GATEWAY_RUN_QUEUE });
}
