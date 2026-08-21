import type PgBoss from 'pg-boss';
import { getPrismaClient } from '@chatbot/shared';
import type { JobExecutor } from '../../executor/types.js';
import { handleTranscriptionWebhookRetry } from './handler.js';
import { healStuckWebhookRetryJobs } from './self-heal.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('transcription-webhook-retry-register');
const JOB_NAME = 'transcription-webhook-retry';
// Same reasoning as the transcription queue: cap attempts, and once exhausted the job
// must finalize (webhookStatus 'undeliverable') rather than retry indefinitely.
const RETRY_LIMIT = 5;

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  if (executor.registerHandler) {
    executor.registerHandler(JOB_NAME, handleTranscriptionWebhookRetry);
  }

  // createQueue is create-ONLY (ON CONFLICT DO NOTHING in pg-boss's own SQL) — in any
  // environment where this queue already existed, updateQueue is what actually applies a
  // changed retryLimit/retryDelay/retryBackoff. See the longer note in
  // jobs/transcription/register.ts, where this exact gap was found.
  const queuePolicy = { name: JOB_NAME, retryLimit: RETRY_LIMIT, retryDelay: 30, retryBackoff: true };
  await boss.createQueue(JOB_NAME, queuePolicy);
  await boss.updateQueue(JOB_NAME, queuePolicy);

  // Must run here, before boss.work() below starts this queue's own polling loop — same
  // ordering requirement as jobs/transcription/register.ts. Confirmed live on 2026-08-05:
  // jobs killed mid-attempt by a worker restart can end up retrying past their own
  // retry_limit forever, since the finalization step that would normally stop them never
  // gets to run to completion. See self-heal.ts for the full mechanism.
  await healStuckWebhookRetryJobs(boss, getPrismaClient()).catch((err) =>
    log.error('Startup self-heal for stuck webhook-retry jobs failed', { err: err instanceof Error ? err.message : err })
  );

  // includeMetadata + explicit complete()/fail() for the same reason as the transcription
  // queue — guarantee a real terminal state regardless of any implicit-completion edge case.
  await boss.work(JOB_NAME, { batchSize: 4, includeMetadata: true }, async (jobs) => {
    for (const job of jobs) {
      const isFinalAttempt = job.retryCount >= job.retryLimit;
      log.info('Processing job', { jobId: job.id, retryCount: job.retryCount, retryLimit: job.retryLimit, isFinalAttempt });
      try {
        await executor.execute(JOB_NAME, { ...(job.data as Record<string, unknown>), isFinalAttempt });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.error('Job execution failed', { jobId: job.id, errorName: error.name, errorMessage: error.message, isFinalAttempt });
        try {
          await boss.fail(JOB_NAME, job.id, { name: error.name, message: error.message });
        } catch (failErr) {
          // See jobs/transcription/register.ts for why this rethrows instead of swallowing.
          log.error('Failed to mark boss job as failed, rethrowing', { jobId: job.id, err: failErr instanceof Error ? failErr.message : failErr });
          throw error;
        }
        continue;
      }
      // Kept out of the try/catch above — see jobs/transcription/register.ts for why a
      // complete() failure must never be treated as an execution failure.
      try {
        await boss.complete(JOB_NAME, job.id);
      } catch (completeErr) {
        log.error('Failed to mark boss job as complete after successful execution', {
          jobId: job.id,
          err: completeErr instanceof Error ? completeErr.message : completeErr,
        });
      }
    }
  });

  log.info('Registered job handler', { jobName: JOB_NAME, retryLimit: RETRY_LIMIT });
}
