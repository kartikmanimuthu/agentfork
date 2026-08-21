import type PgBoss from 'pg-boss';
import { handleTranscriptionUploadExpiry } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('transcription-upload-expiry-register');
const JOB_NAME = 'transcription-upload-expiry';
const CRON_SCHEDULE = '15 3 * * *'; // 03:15 UTC daily

export async function register(boss: PgBoss): Promise<void> {
  await boss.createQueue(JOB_NAME);

  await boss.work(JOB_NAME, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      log.info('Running transcription upload expiry sweep', { jobId: job.id });
      await handleTranscriptionUploadExpiry();
    }
  });

  try {
    await boss.unschedule(JOB_NAME);
  } catch {
    // no existing schedule
  }

  await boss.schedule(JOB_NAME, CRON_SCHEDULE, {});
  log.info('Registered cron job', { jobName: JOB_NAME, schedule: CRON_SCHEDULE });
}
