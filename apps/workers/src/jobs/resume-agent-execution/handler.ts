import { getPrismaClient } from '@chatbot/shared/workers';
import { PausedExecutionService, LlmProviderService } from '@chatbot/shared';
import { createLogger } from '../../lib/logger.js';
import { resumeAgentExecutionSchema } from './schema.js';

const log = createLogger('resume-agent-execution');

export async function handleResumeAgentExecution(data: unknown): Promise<void> {
  const { pausedExecutionId, userInput, tenantId } = resumeAgentExecutionSchema.parse(data);

  const db = getPrismaClient();

  // Load the paused execution (already claimed by the API — resumedAt is set)
  const paused = await (db as any).pausedExecution.findUnique({ where: { id: pausedExecutionId } });
  if (!paused) {
    log.warn({ pausedExecutionId }, 'Paused execution not found, skipping');
    return;
  }

  // Load the parent execution to get agentVersionId
  const execution = await (db as any).apiKeyExecution.findUnique({ where: { id: paused.executionId } });
  if (!execution) {
    log.warn({ executionId: paused.executionId }, 'ApiKeyExecution not found, skipping');
    return;
  }

  const agentVersion = await (db as any).agentVersion.findUnique({ where: { id: execution.agentVersionId } });
  const graphCfg = (agentVersion?.config as { nodes?: any[]; edges?: any[] }) ?? {};
  const graph = { nodes: graphCfg.nodes ?? [], edges: graphCfg.edges ?? [] };

  // Restore state and inject human reply
  const savedState = paused.graphState as any;
  const restoredState = {
    ...savedState,
    channels: {
      ...savedState.channels,
      [paused.outputChannel]: userInput,
      __paused: false,
      __resumeToken: null,
    },
    currentNodeId: paused.nextNodeId,
  };

  const { GraphExecutor, createNodeExecutors } = await import('@chatbot/agent-studio/server');
  const pausedExecService = new PausedExecutionService(db as any);

  const llmProviderFn = async (providerId?: string) => {
    const llmProviderService = new LlmProviderService(tenantId);
    const cfg = providerId
      ? await llmProviderService.getConfigById(providerId)
      : await llmProviderService.getDefaultConfig();
    const { createLLMProvider } = await import('@chatbot/ai');
    return createLLMProvider(cfg);
  };

  const graphExecutor = new GraphExecutor({ llmProvider: llmProviderFn, prisma: db });
  for (const exec of createNodeExecutors()) graphExecutor.register(exec);

  log.info({ pausedExecutionId, executionId: paused.executionId, nextNodeId: paused.nextNodeId }, 'Resuming graph execution');

  try {
    let secondPause = false;

    const finalState = await graphExecutor.executeFromState(
      graph,
      restoredState,
      { executionId: paused.executionId, agentId: paused.agentId, tenantId, userId: savedState.metadata?.userId ?? '' },
      {
        onPause: async (pauseInfo) => {
          secondPause = true;
          await pausedExecService.create({
            tenantId,
            agentId: paused.agentId,
            executionId: paused.executionId,
            graphState: pauseInfo.state,
            prompt: pauseInfo.prompt,
            outputChannel: pauseInfo.outputChannel,
            nextNodeId: pauseInfo.nextNodeId,
            resumeToken: pauseInfo.resumeToken,
          });
          await (db as any).apiKeyExecution.update({
            where: { id: paused.executionId },
            data: { status: 'paused' },
          });
        },
      }
    );

    if (!secondPause) {
      const text = String((finalState.channels.__output as string) ?? '');
      await (db as any).apiKeyExecution.update({
        where: { id: paused.executionId },
        data: { status: 'completed', output: { text }, completedAt: new Date() },
      });
      log.info({ executionId: paused.executionId, outputLength: text.length }, 'Graph resume completed');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ pausedExecutionId, executionId: paused.executionId, err: msg }, 'Graph resume failed');
    await (db as any).apiKeyExecution.update({
      where: { id: paused.executionId },
      data: { status: 'failed', error: msg, completedAt: new Date() },
    });
    throw err;
  }
}
