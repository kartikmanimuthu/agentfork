import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { RouterNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:router-executor');

export class RouterNodeExecutor implements NodeExecutor {
  type = 'router';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as RouterNodeConfig;
    const startedAt = new Date().toISOString();

    let matchedTarget: string | null = null;

    for (const { condition, target } of config.conditions) {
      const result = this.evaluateCondition(condition, ctx.state.channels);
      if (result) {
        matchedTarget = target;
        break;
      }
    }

    if (!matchedTarget && config.defaultTarget) {
      matchedTarget = config.defaultTarget;
    }

    if (!matchedTarget) {
      const error = `router node "${ctx.node.id}": no condition matched and no default target`;
      logger.error({ nodeId: ctx.node.id }, error);
      throw new Error(error);
    }

    logger.info({ nodeId: ctx.node.id, matchedTarget }, 'router condition matched');

    return {
      stateUpdates: {},
      next: [matchedTarget],
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'router',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { conditionCount: config.conditions.length },
        output: { matchedTarget },
      },
    };
  }

  private evaluateCondition(expression: string, channels: Record<string, unknown>): boolean {
    try {
      const fn = new Function(...Object.keys(channels), `return Boolean(${expression})`);
      return fn(...Object.values(channels));
    } catch (error) {
      logger.warn({ expression, error }, 'condition evaluation failed');
      return false;
    }
  }
}
