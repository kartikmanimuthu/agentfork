import { getPrismaClient } from '@chatbot/shared';
import { TranscriptionUploadService } from '@chatbot/shared/server';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('transcription-upload-expiry-handler');

/**
 * Marks presigned uploads that were never transcribed as `expired`.
 *
 * Keeps the upload table honest so the transcribe route can answer `410 upload_expired` from
 * stored state rather than inferring it from a timestamp. Reclaiming the underlying S3 bytes
 * is handled separately by the lifecycle rule on the `transcription/_uploads/` prefix — this
 * job only maintains the database side.
 */
export async function handleTranscriptionUploadExpiry(): Promise<void> {
  const db = getPrismaClient();
  try {
    const count = await TranscriptionUploadService.expireStale(db);
    log.info('Transcription upload expiry sweep complete', { expiredCount: count });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('Transcription upload expiry sweep failed', { errorMessage: error.message });
    throw error;
  }
}
