import { createBoss } from './boss.js';
import { createExecutor } from './executor/factory.js';
import { createLogger } from './lib/logger.js';
import { register as registerDocumentIngestion } from './jobs/document-ingestion/register.js';
import { register as registerWebCrawl } from './jobs/web-crawl/register.js';
import { register as registerInferenceSessionAnalytics } from './jobs/inference-session-analytics/register.js';
import { register as registerInferenceSessionIdleWatcher } from './jobs/inference-session-idle-watcher/register.js';
import { register as registerResumeAgentExecution } from './jobs/resume-agent-execution/register.js';
import { register as registerExpirePausedExecutions } from './jobs/expire-paused-executions/register.js';
import { register as registerEvaluatorRun } from './jobs/evaluator-run/register.js';
import { register as registerExperimentRun } from './jobs/experiment-run/register.js';
import { register as registerClawGatewayRun } from './jobs/claw-gateway-run/register.js';
import {
  register as registerClawScheduler,
  stopClawSchedulerSweeper,
} from './jobs/claw-scheduler/register.js';
import { register as registerTranscription } from './jobs/transcription/register.js';
import { register as registerTranscriptionWebhookRetry } from './jobs/transcription-webhook-retry/register.js';
import { register as registerTranscriptionUploadExpiry } from './jobs/transcription-upload-expiry/register.js';
import { register as registerCacheCleanup } from './jobs/cache-cleanup/register.js';
import { registerSchedules } from './jobs/web-crawl/scheduler.js';
import { env } from './env';

const log = createLogger('workers');
const boss = createBoss();
const executor = createExecutor(env.WORKER_ARCH);

async function main() {
  log.info('Starting pg-boss...');

  boss.on('error', (error) => {
    log.error('pg-boss error', { error: String(error) });
  });

  await boss.start();
  log.info('pg-boss started');

  await registerDocumentIngestion(boss, executor);
  await registerWebCrawl(boss, executor);
  await registerInferenceSessionAnalytics(boss, executor);
  await registerInferenceSessionIdleWatcher(boss);
  await registerResumeAgentExecution(boss, executor);
  await registerExpirePausedExecutions(boss);
  await registerEvaluatorRun(boss, executor);
  await registerExperimentRun(boss, executor);
  await registerClawGatewayRun(boss, executor);
  await registerClawScheduler(boss, executor);
  await registerTranscription(boss, executor);
  await registerTranscriptionWebhookRetry(boss, executor);
  await registerTranscriptionUploadExpiry(boss);
  await registerCacheCleanup(boss);

  await registerSchedules(boss);
  log.info('Schedules registered. Waiting for work...');

  // Deliberately shorter than ECS's own stopTimeout (30s by default on Fargate unless the
  // task definition overrides it — currently unset here, so 30s applies). pg-boss's graceful
  // stop already does the right thing on its own: it waits for in-flight jobs, then
  // explicitly fails (not abandons) any job still running via its internal failWip() call.
  // But that only happens if this process is still alive to run it — if our own timeout
  // matched or exceeded ECS's kill deadline, ECS's SIGKILL could fire first and take the
  // process down mid-wait, before failWip() ever runs, leaving the job "active" forever
  // (this is believed to be the actual mechanism behind an August 2026 incident: two jobs
  // orphaned by a deploy that raced this exact window). Keeping a real margin below the ECS
  // deadline is what makes failWip() reliably win that race instead of sometimes losing it.
  // If the ECS task's stopTimeout is ever raised (to give slow-but-legitimate jobs more room
  // to finish), raise this value too, keeping the same ~5-10s margin below it.
  const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 20_000;

  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down...`, { gracefulTimeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS });
    // Stop the sweeper FIRST: enqueueing a tick against a stopping boss throws
    // while in-flight handlers are still draining.
    stopClawSchedulerSweeper();
    await boss.stop({ graceful: true, timeout: GRACEFUL_SHUTDOWN_TIMEOUT_MS });
    log.info('pg-boss stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.error('Fatal error', { error: String(err), stack: err?.stack, errors: err?.errors ? err.errors.map((e: any) => ({ msg: e.message, stack: e.stack })) : undefined });
  process.exit(1);
});
