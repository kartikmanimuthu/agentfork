// Standalone entrypoint for ephemeral ECS Fargate tasks in horizontal mode.
// Runs a single named job handler and exits — no daemon loop, no queue polling.
// Invoked as: node dist/job-runner.js --job <name> --data '<json>'

import { VerticalExecutor } from './executor/vertical.js';
import { createBoss } from './boss.js';
import { createLogger } from './lib/logger.js';
import { handleDocumentIngestion } from './jobs/document-ingestion/handler.js';
import { handleWebCrawl } from './jobs/web-crawl/handler.js';
import { handleInferenceSessionAnalytics } from './jobs/inference-session-analytics/handler.js';
import { handleInferenceSessionIdleWatcher } from './jobs/inference-session-idle-watcher/handler.js';
import { handleEvaluatorRun } from './jobs/evaluator-run/handler.js';
import { handleExperimentRun } from './jobs/experiment-run/handler.js';

const log = createLogger('job-runner');

function parseArgs(): { job: string; data: unknown } {
  const args = process.argv.slice(2);
  const jobIdx = args.indexOf('--job');
  const dataIdx = args.indexOf('--data');

  if (jobIdx === -1 || jobIdx + 1 >= args.length) {
    console.error("Usage: job-runner --job <name> [--data '<json>']");
    process.exit(1);
  }

  const job = args[jobIdx + 1];
  let data: unknown = {};
  if (dataIdx !== -1 && dataIdx + 1 < args.length) {
    try {
      data = JSON.parse(args[dataIdx + 1]);
    } catch {
      console.error(`Invalid JSON for --data: ${args[dataIdx + 1]}`);
      process.exit(1);
    }
  }

  return { job, data };
}

async function main(): Promise<void> {
  const { job, data } = parseArgs();
  log.info('Starting job-runner', { job });

  // idle-watcher needs pg-boss to enqueue downstream analytics jobs
  const boss = createBoss();
  await boss.start();

  const executor = new VerticalExecutor();
  executor.registerHandler('document-ingestion', handleDocumentIngestion);
  executor.registerHandler('web-crawl', handleWebCrawl);
  executor.registerHandler('inference-session-analytics', handleInferenceSessionAnalytics);
  // wrap so the handler receives boss, not jobData
  executor.registerHandler('inference-session-idle-watcher', () => handleInferenceSessionIdleWatcher(boss));
  executor.registerHandler('evaluator-run', (data) => handleEvaluatorRun(data, boss));
  executor.registerHandler('experiment-run', (data) => handleExperimentRun(data, boss));

  const knownJobs = ['document-ingestion', 'web-crawl', 'inference-session-analytics', 'inference-session-idle-watcher', 'evaluator-run', 'experiment-run'];
  if (!knownJobs.includes(job)) {
    log.error('Unknown job name', { job, available: knownJobs });
    await boss.stop({ graceful: false });
    process.exit(1);
  }

  try {
    await executor.execute(job, data);
    log.info('Job-runner complete', { job });
  } finally {
    await boss.stop({ graceful: true, timeout: 10000 });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error('Job-runner failed', { error: err instanceof Error ? err.message : String(err), stack: err?.stack });
    process.exit(1);
  });
