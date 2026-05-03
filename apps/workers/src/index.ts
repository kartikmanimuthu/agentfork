import { createBoss } from './boss.js';
import { createExecutor } from './executor/factory.js';
import { createLogger } from './lib/logger.js';
import { register as registerMessageEmbedding } from './jobs/message-embedding/register.js';
import { register as registerConversationSummary } from './jobs/conversation-summary/register.js';
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

  await registerMessageEmbedding(boss, executor);
  await registerConversationSummary(boss, executor);

  log.info('All jobs registered. Waiting for work...');

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
  log.error('Fatal error', { error: String(err) });
  process.exit(1);
});
