import type PgBoss from 'pg-boss';
import type { PrismaClient } from '@prisma/client';
import { TranscriptionJobService, WebhookService } from '@chatbot/shared';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('transcription-self-heal');

// Legitimate async transcriptions can run for a long time (the engine call alone is allowed
// up to TRANSCRIPTION_ENGINE_ASYNC_TIMEOUT_MS, several hours), so this has to sit safely
// above that — it's only meant to catch a job that's actually dead, not one that's just slow.
const STALE_ACTIVE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

interface StaleActiveJobRow {
  id: string;
  data: {
    jobId: string;
    tenantId: string;
    webhookUrl?: string | null;
    webhookSecret?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    s3Key?: string | null;
    uploadId?: string | null;
    clientReference?: string | null;
  };
}

/**
 * Runs once at worker startup, before `boss.work()` is registered for the 'transcription'
 * queue — finds any job still marked 'active' from a *previous* worker process that died
 * mid-job (a hard container kill during a deploy never gets a chance to run our own
 * complete()/fail() calls, or even reach the isFinalAttempt-gated failure handling in
 * handler.ts), fails it via pg-boss's own public API, and finalizes the underlying
 * TranscriptionJob row plus attempts its failure webhook. This automates, on every boot,
 * the manual recovery a human had to do by hand during the incident that motivated this file
 * (two jobs stuck 'active' for over an hour, blocking every other queued job behind them on
 * this batchSize:1 queue).
 *
 * Must run before `boss.work()` starts for this queue: pg-boss's own in-process concurrency
 * bookkeeping only exists once work() is running, so fixing up rows beforehand can't desync
 * it. Calling `boss.fail()` against a job the SAME live process already has an active
 * work() loop for is what caused a second incident during this same remediation — never call
 * this once the queue's worker loop has started.
 */
export async function healOrphanedTranscriptionJobs(boss: PgBoss, db: PrismaClient): Promise<void> {
  const threshold = new Date(Date.now() - STALE_ACTIVE_THRESHOLD_MS);
  const staleJobs = await db.$queryRaw<StaleActiveJobRow[]>`
    SELECT id, data
    FROM pgboss.job
    WHERE name = 'transcription' AND state = 'active' AND started_on < ${threshold}
  `;

  if (staleJobs.length === 0) return;

  log.warn('Found orphaned active transcription jobs from a previous worker process', { count: staleJobs.length });

  const jobService = new TranscriptionJobService(db);
  const message = 'Transcription worker was restarted while this job was in progress and it could not be completed. Please resubmit.';

  for (const job of staleJobs) {
    try {
      await boss.fail('transcription', job.id, { name: 'Error', message });
      await jobService.fail(job.data.jobId, message);

      if (job.data.webhookUrl) {
        const delivery = await new WebhookService().deliverWithToken(job.data.webhookUrl, job.data.webhookSecret ?? null, {
          executionId: job.data.jobId,
          agentId: '',
          ...(job.data.uploadId ? { uploadId: job.data.uploadId } : {}),
          ...(job.data.clientReference ? { clientReference: job.data.clientReference } : {}),
          status: 'failed',
          input: { fileName: job.data.fileName ?? null, mimeType: job.data.mimeType ?? null, s3Key: job.data.s3Key ?? null },
          error: message,
          cacheHit: false,
          timestamp: new Date().toISOString(),
        });
        await jobService.setWebhookResult(job.data.jobId, delivery.success, true);
      }

      log.warn('Healed an orphaned transcription job', { pgBossJobId: job.id, jobId: job.data.jobId });
    } catch (err) {
      log.error('Failed to heal an orphaned transcription job — will retry on next boot', {
        pgBossJobId: job.id,
        jobId: job.data.jobId,
        err: err instanceof Error ? err.message : err,
      });
    }
  }
}
