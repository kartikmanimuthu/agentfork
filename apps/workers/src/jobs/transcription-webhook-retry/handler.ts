import { getPrismaClient, TranscriptionJobService, WebhookService } from '@chatbot/shared';
import { transcriptionWebhookRetrySchema } from './schema.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('transcription-webhook-retry-handler');

/**
 * Redelivers a completed/failed transcription job's webhook independently of the
 * transcription work itself. Enqueued only when the FIRST delivery attempt (made
 * inline in transcription-runner.ts) fails. Rethrows on a non-final failure so
 * register.ts's retry policy redrives this job; on the final allowed attempt it
 * instead marks the job's webhookStatus 'undeliverable' and returns normally, so the
 * job reaches a clean terminal state instead of exhausting retries on a rejection.
 */
export async function handleTranscriptionWebhookRetry(raw: unknown): Promise<void> {
  const data = transcriptionWebhookRetrySchema.parse(raw);
  const db = getPrismaClient();

  const job = await db.transcriptionJob.findFirst({
    where: { id: data.jobId, tenantId: data.tenantId },
    include: { apiKey: { select: { webhookSecret: true } } },
  });
  if (!job || !job.webhookUrl) {
    log.warn('Webhook retry skipped — job or webhookUrl missing', { jobId: data.jobId });
    return;
  }

  const isFailed = job.status === 'failed';
  const isSystemAnnouncement =
    job.output !== null && typeof job.output === 'object' && (job.output as Record<string, unknown>).systemAnnouncement === true;
  const webhook = new WebhookService();
  const delivery = await webhook.deliverWithToken(job.webhookUrl, job.apiKey.webhookSecret ?? null, {
    executionId: job.id,
    agentId: '',
    status: isFailed ? 'failed' : 'completed',
    input: { fileName: job.fileName, mimeType: job.mimeType },
    ...(isFailed
      ? { error: job.error ?? 'Transcription failed' }
      : isSystemAnnouncement
        ? { output: job.output as Record<string, unknown> }
        : { output: { text: job.transcript, language: job.language, durationSec: job.durationSec } }),
    cacheHit: false,
    latencyMs: job.latencyMs ?? undefined,
    timestamp: new Date().toISOString(),
  });

  if (!delivery.success) {
    if (data.isFinalAttempt) {
      // Give up for good — mark it undeliverable rather than throwing, so this job
      // finalizes as a clean terminal state instead of pg-boss exhausting retries on a
      // rejection (which is exactly what left jobs stuck "active" before this fix).
      await new TranscriptionJobService(db).setWebhookResult(job.id, false, true);
      log.error('Webhook redelivery exhausted all retries — giving up', { jobId: job.id, error: delivery.error, status: delivery.status });
      return;
    }
    await new TranscriptionJobService(db).setWebhookResult(job.id, false);
    log.warn('Webhook retry delivery failed, will retry', { jobId: job.id, error: delivery.error, status: delivery.status });
    throw new Error(`Webhook redelivery failed: ${delivery.error ?? delivery.status}`);
  }

  await new TranscriptionJobService(db).setWebhookResult(job.id, true);
  log.info('Webhook retry delivered', { jobId: job.id });
}
