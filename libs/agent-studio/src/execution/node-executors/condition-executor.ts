import pino from 'pino';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { ConditionNodeConfig } from '../../types/nodes';

const logger = pino({ name: 'condition-executor' });

export class ConditionNodeExecutor implements NodeExecutor {
  type = 'condition';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as ConditionNodeConfig;
    const startedAt = new Date().toISOString();

    try {
      const channelNames = Object.keys(ctx.state.channels);
      const channelValues = Object.values(ctx.state.channels);
      const evaluator = new Function(...channelNames, `return (${config.expression});`);
      const result = Boolean(evaluator(...channelValues));

      const nextBranch = result ? config.trueBranch : config.falseBranch;

      logger.info({ nodeId: ctx.node.id, result, nextBranch }, 'Condition evaluated');

      return {
        stateUpdates: {},
        next: [nextBranch],
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'condition',
          nodeLabel: ctx.node.label,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { expression: config.expression },
          output: { result, nextBranch },
        },
      };
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'Condition evaluation failed');
      throw error;
    }
  }
}
