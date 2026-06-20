import type PgBoss from 'pg-boss';
import { getPrismaClient } from '@chatbot/shared/workers';
import { EvaluatorRunnerService, LlmProviderService, createLogger } from '@chatbot/shared/workers';
import { createLLMProvider } from '@chatbot/ai';
import { evaluatorRunJobSchema } from './schema.js';

const log = createLogger('evaluator-run');

export async function handleEvaluatorRun(data: unknown, _boss?: PgBoss): Promise<void> {
  const { evaluatorId, tenantId, limit } = evaluatorRunJobSchema.parse(data);
  log.info({ evaluatorId, tenantId }, 'Starting evaluator run');

  const db = getPrismaClient();
  const runner = new EvaluatorRunnerService(db as any);
  const llmService = new LlmProviderService(tenantId);
  const config = await llmService.getDefaultConfig();
  const provider = createLLMProvider(config);

  const targets = await db.inferenceSessionMessage.findMany({
    where: { session: { tenantId } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true },
  });

  let processed = 0;
  let failed = 0;
  for (const target of targets) {
    try {
      await runner.run({ tenantId, evaluatorId, provider, targetType: 'MESSAGE', targetId: target.id });
      processed++;
    } catch (err) {
      failed++;
      log.error({ err, targetId: target.id }, 'Evaluator target failed');
    }
  }
  log.info({ evaluatorId, tenantId, processed, failed }, 'Evaluator run complete');
}
