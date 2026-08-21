import type PgBoss from 'pg-boss';
import { getPrismaClient, env } from '@chatbot/shared';
import type { JobExecutor } from '../../executor/types.js';
import { handleTranscription } from './handler.js';
import { healOrphanedTranscriptionJobs } from './self-heal.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('transcription-register');
const JOB_NAME = 'transcription';
// Cap retries so a genuinely broken engine can't hold the single GPU slot forever — pg-boss
// stops once retryCount >= retryLimit, which means retryLimit=5 allows 6 TOTAL attempts (the
// initial try plus 5 retries), not 5. After that the job must reach a terminal state and
// notify the caller, not keep retrying indefinitely.
const RETRY_LIMIT = 5;
const TOTAL_ATTEMPTS = RETRY_LIMIT + 1;
// Flat and short, not exponential-backed-off: the circuit breaker in libs/ai/transcription.ts
// is what actually protects a down engine from being hammered (it fails every call instantly
// for 20s after any network-level failure) — pg-boss's own gap between attempts only needs
// to be short and predictable on top of that.
//
// Measured (not just calculated) on 2026-08-04 against a genuinely unreachable endpoint:
// retryDelay=5 produced a real gap of ~10s between attempts, not 5s — pg-boss's worker
// polls on a fixed ~2s cycle and only picks up a job once it's actually due, so the real
// gap is consistently larger than the configured delay by roughly pg-boss's own polling
// overhead. 2s is close to that polling cycle's own floor — going much lower has
// diminishing returns since a job still can't be discovered faster than the next poll.
const RETRY_DELAY_SECONDS = 2;
const RETRY_BACKOFF = false;

async function processJob(boss: PgBoss, executor: JobExecutor, job: PgBoss.JobWithMetadata): Promise<void> {
  const isFinalAttempt = job.retryCount >= job.retryLimit;
  log.info('Processing job', { jobId: job.id, retryCount: job.retryCount, retryLimit: job.retryLimit, isFinalAttempt });
  try {
    await executor.execute(JOB_NAME, { ...(job.data as Record<string, unknown>), isFinalAttempt, totalAttempts: TOTAL_ATTEMPTS });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('Job execution failed', { jobId: job.id, errorName: error.name, errorMessage: error.message, isFinalAttempt });
    try {
      await boss.fail(JOB_NAME, job.id, { name: error.name, message: error.message });
    } catch (failErr) {
      // fail() itself failing must not be swallowed — see the self-heal mechanism
      // (self-heal.ts), which recovers a job left stuck "active" on next worker
      // startup. Under Promise.allSettled a rethrow here only fails THIS job's own
      // promise, not the whole batch — logging is the last line of immediate defense.
      log.error('Failed to mark boss job as failed', { jobId: job.id, err: failErr instanceof Error ? failErr.message : failErr });
    }
    return;
  }
  // Only reached on success. Kept out of the try/catch above so a failure in complete()
  // itself — the execution already succeeded and its webhook already delivered — can
  // never be mistaken for an execution failure and trigger a retry (which would re-run
  // the job and send a duplicate webhook).
  try {
    await boss.complete(JOB_NAME, job.id);
  } catch (completeErr) {
    log.error('Failed to mark boss job as complete after successful execution', {
      jobId: job.id,
      err: completeErr instanceof Error ? completeErr.message : completeErr,
    });
  }
}

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  if (executor.registerHandler) {
    executor.registerHandler(JOB_NAME, handleTranscription);
  }

  // Scoped to this queue only (doesn't touch the global retryLimit/expireInHours defaults
  // other job types rely on).
  //
  // createQueue is create-ONLY — pg-boss's own SQL is `ON CONFLICT DO NOTHING`, so in any
  // environment where this queue already existed (i.e. everywhere this feature has run
  // before, including UAT), passing new retryLimit/retryDelay/retryBackoff values here is a
  // silent no-op and the OLD stored policy keeps being used. updateQueue is the explicit
  // "make the stored policy match what the code says" call — always run it too, so a change
  // to the constants above actually takes effect on the next deploy, not just for a queue
  // that's never existed before.
  const queuePolicy = { name: JOB_NAME, retryLimit: RETRY_LIMIT, retryDelay: RETRY_DELAY_SECONDS, retryBackoff: RETRY_BACKOFF };
  await boss.createQueue(JOB_NAME, queuePolicy);
  await boss.updateQueue(JOB_NAME, queuePolicy);

  // Must run here — after the queue policy is set, but strictly before boss.work() below
  // starts this queue's own polling loop. pg-boss's in-process concurrency bookkeeping for a
  // queue only exists once work() is running; fixing up stale rows before that can't desync
  // it. Doing this same kind of fix-up against a queue whose work() loop was already live is
  // what caused a second incident during the outage this guards against — never move this
  // call after boss.work(), and never call it from anywhere other than startup.
  await healOrphanedTranscriptionJobs(boss, getPrismaClient()).catch((err) =>
    log.error('Startup self-heal for orphaned transcription jobs failed', { err: err instanceof Error ? err.message : err })
  );

  // env.TRANSCRIPTION_WORKER_BATCH_SIZE independent single-job polling loops, not one
  // batch-fetching loop. pg-boss 10.4.2 has no teamSize/teamConcurrency option — a single
  // boss.work() call with a larger batchSize hands the whole batch to one callback invocation,
  // and pg-boss only polls for the next batch once that callback's returned promise fully
  // resolves. That couples a fast job to its slowest batch-mate: if job A finishes in 5s and
  // its batch-mate job B takes 20 minutes, A's slot sits idle for the remaining ~20 minutes
  // instead of picking up the next queued job, even though nothing about A's completion
  // depends on B. Calling boss.work() N separate times, each with batchSize: 1, registers N
  // truly independent polling loops instead — each slot picks up its next job as soon as its
  // own current job finishes, regardless of what any other slot is doing. Raise N only once a
  // safe concurrency ceiling has been found empirically against the real box (see the design
  // spec's Verification / "Determining N" section) — from then on it's an env var change, not
  // a code change.
  // includeMetadata surfaces retryCount/retryLimit so the handler knows whether this is the
  // last allowed attempt (finalize + notify) or an earlier one (stay quiet, let pg-boss
  // retry). complete()/fail() are called explicitly here rather than relying only on the
  // callback resolving/throwing — a job was previously found stuck in "active" forever after
  // a failure, with pg-boss never finishing the state transition; calling these directly
  // guarantees every job reaches a real terminal state.
  await Promise.all(
    Array.from({ length: env.TRANSCRIPTION_WORKER_BATCH_SIZE }, () =>
      boss.work<object>(JOB_NAME, { batchSize: 1, includeMetadata: true }, async ([job]) => {
        await processJob(boss, executor, job);
      })
    )
  );

  log.info('Registered job handler', { jobName: JOB_NAME, retryLimit: RETRY_LIMIT, retryDelaySeconds: RETRY_DELAY_SECONDS });
}
