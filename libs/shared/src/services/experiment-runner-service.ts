import { createLogger } from '../logging/logger';
import type { ExperimentInferenceDb } from './experiment-inference-service';
import { ExperimentInferenceService } from './experiment-inference-service';
import type { LLMProvider } from '@chatbot/ai';

const logger = createLogger('experiment-runner-service');

export interface ExperimentRunnerDb extends ExperimentInferenceDb {
  experiment: { findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<ExperimentRow | null>; update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown> };
  datasetItem: { findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<Array<{ id: string; input: unknown }>> };
  experimentRunItem: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

interface ExperimentRow {
  id: string;
  tenantId: string;
  datasetId: string;
  agentVersionIds: string[];
  scoreConfigIds: string[];
  status: string;
}

export interface RunExperimentInput {
  tenantId: string;
  experimentId: string;
  provider: LLMProvider;
  userId: string;
}

export class ExperimentRunnerService {
  private readonly inferenceService: ExperimentInferenceService;

  constructor(private readonly db: ExperimentRunnerDb) {
    this.inferenceService = new ExperimentInferenceService(db);
  }

  async run(input: RunExperimentInput): Promise<void> {
    try {
      const experiment = (await this.db.experiment.findFirst({
        where: { id: input.experimentId, tenantId: input.tenantId },
      })) as ExperimentRow | null;
      if (!experiment) throw new Error('Experiment not found');

      logger.info({ tenantId: input.tenantId, experimentId: experiment.id }, 'Starting experiment run');
      await this.db.experiment.update({ where: { id: experiment.id }, data: { status: 'RUNNING' } });

      const items = await this.db.datasetItem.findMany({ where: { datasetId: experiment.datasetId, status: 'ACTIVE' } });
      let completed = 0;
      let failed = 0;

      for (const item of items) {
        for (const agentVersionId of experiment.agentVersionIds) {
          const runItem = (await this.db.experimentRunItem.create({
            data: {
              experimentId: experiment.id,
              tenantId: input.tenantId,
              datasetItemId: item.id,
              agentVersionId,
              status: 'RUNNING',
            },
          })) as { id: string };

          try {
            const result = await this.inferenceService.run({
              tenantId: input.tenantId,
              agentVersionId,
              input: item.input,
              provider: input.provider,
              userId: input.userId,
            });
            await this.db.experimentRunItem.update({
              where: { id: runItem.id },
              data: {
                status: 'COMPLETED',
                outputText: result.outputText,
                outputJson: result.outputJson as any,
                latencyMs: result.latencyMs,
                tokenUsage: result.tokenUsage as any,
                inferenceSessionId: result.inferenceSessionId || null,
              },
            });
            completed++;
          } catch (err) {
            failed++;
            await this.db.experimentRunItem.update({
              where: { id: runItem.id },
              data: { status: 'FAILED', error: err instanceof Error ? err.message : String(err) },
            });
            logger.error({ err, runItemId: runItem.id }, 'Experiment run item failed');
          }
        }
      }

      await this.db.experiment.update({
        where: { id: experiment.id },
        data: { status: failed > 0 && completed === 0 ? 'FAILED' : 'COMPLETED' },
      });
      logger.info({ tenantId: input.tenantId, experimentId: experiment.id, completed, failed }, 'Experiment run complete');
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, experimentId: input.experimentId }, 'Failed to run experiment');
      throw error;
    }
  }
}
