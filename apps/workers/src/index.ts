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

  await registerSchedules(boss);
  log.info('Schedules registered. Waiting for work...');

  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down...`);
    await boss.stop({ graceful: true, timeout: 30000 });
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
