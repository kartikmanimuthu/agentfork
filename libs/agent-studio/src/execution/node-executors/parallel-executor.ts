import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { ParallelNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:parallel-executor');

export class ParallelNodeExecutor implements NodeExecutor {
  type = 'parallel';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as ParallelNodeConfig;
    const startedAt = new Date().toISOString();

    logger.warn(
      { nodeId: ctx.node.id, branches: config.branches },
      'Parallel execution is a placeholder — GraphExecutor changes required for true parallelism'
    );

    return {
      stateUpdates: { [config.outputChannel]: null },
      next: config.branches,
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'parallel',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { branches: config.branches, mergeStrategy: config.mergeStrategy },
        output: { dispatched: config.branches },
      },
    };
  }
}
