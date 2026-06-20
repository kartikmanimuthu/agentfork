import type PgBoss from 'pg-boss';
import { getPrismaClient } from '@chatbot/shared/workers';
import { ExperimentRunnerService, LlmProviderService, createLogger } from '@chatbot/shared/workers';
import { createLLMProvider } from '@chatbot/ai';
import { experimentRunJobSchema } from './schema.js';

const log = createLogger('experiment-run');

export async function handleExperimentRun(data: unknown, _boss?: PgBoss): Promise<void> {
  const { experimentId, tenantId } = experimentRunJobSchema.parse(data);
  log.info({ experimentId, tenantId }, 'Starting experiment run job');

  const db = getPrismaClient();
  const runner = new ExperimentRunnerService(db as any);
  const llmService = new LlmProviderService(tenantId);
  const config = await llmService.getDefaultConfig();
  const provider = createLLMProvider(config);

  await runner.run({ tenantId, experimentId, provider, userId: 'system' });
}
