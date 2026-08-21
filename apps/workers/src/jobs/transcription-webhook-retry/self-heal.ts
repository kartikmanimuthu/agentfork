import type PgBoss from 'pg-boss';
import type { PrismaClient } from '@prisma/client';
import { TranscriptionJobService } from '@chatbot/shared';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('transcription-webhook-retry-self-heal');

interface StuckRetryJobRow {
  id: string;
  data: { jobId: string; tenantId: string };
  retry_count: number;
  retry_limit: number;
}

/**
 * Runs once at worker startup, before `boss.work()` is registered for the
 * 'transcription-webhook-retry' queue — finds jobs whose `retry_count` has already reached
 * or passed `retry_limit` but which never reached a terminal ('completed'/'failed') state.
 *
 * By design this should be impossible: register.ts computes `isFinalAttempt` from the same
 * retryCount/retryLimit on every dispatch, and once true, handler.ts stops throwing so the
 * job completes instead of retrying again. But confirmed live on 2026-08-05 (via CloudWatch
 * logs spanning two different container hostnames — i.e. across a worker restart), several
 * jobs kept logging "will retry" indefinitely, well past the attempt where retryCount should
 * have first reached retryLimit — the worker was killed (deploy) between finishing an
 * attempt and this job's fail()/complete() call landing, so pg-boss's own retry bookkeeping
 * advanced past retry_limit without register.ts's finalization logic ever running to
 * completion for that specific attempt. That leaves the row stuck retrying forever: every
 * later attempt re-fetches it, sees retryCount already >= retryLimit, but ONLY finalizes
 * cleanly if it can run start-to-finish without being killed again mid-way — an unbounded
 * number of retries if the process is repeatedly restarted at the wrong instant.
 *
 * Rather than trust retryCount/isFinalAttempt bookkeeping alone to always self-correct,
 * this force-finalizes any row that already violates the retry_count < retry_limit invariant
 * pg-boss itself relies on to decide retry vs failed — mirroring jobs/transcription/self-heal.ts.
 */
export async function healStuckWebhookRetryJobs(boss: PgBoss, db: PrismaClient): Promise<void> {
  const stuckJobs = await db.$queryRaw<StuckRetryJobRow[]>`
    SELECT id, data, retry_count, retry_limit
    FROM pgboss.job
    WHERE name = 'transcription-webhook-retry'
      AND state NOT IN ('completed', 'failed')
      AND retry_count >= retry_limit
  `;

  if (stuckJobs.length === 0) return;

  log.warn('Found webhook-retry jobs stuck past their retry limit from a previous worker process', { count: stuckJobs.length });

  const jobService = new TranscriptionJobService(db);

  for (const job of stuckJobs) {
    try {
      await jobService.setWebhookResult(job.data.jobId, false, true);
      await boss.fail('transcription-webhook-retry', job.id, {
        name: 'Error',
        message: 'Webhook redelivery exceeded its retry limit but was never finalized — force-closed at worker startup',
      });
      log.warn('Force-finalized a stuck webhook-retry job', { pgBossJobId: job.id, jobId: job.data.jobId });
    } catch (err) {
      log.error('Failed to heal a stuck webhook-retry job — will retry on next boot', {
        pgBossJobId: job.id,
        jobId: job.data.jobId,
        err: err instanceof Error ? err.message : err,
      });
    }
  }
}
