import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { DelayNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:delay-executor');

export class DelayNodeExecutor implements NodeExecutor {
  type = 'delay';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as DelayNodeConfig;
    const startedAt = new Date().toISOString();

    let delay = config.delayMs;

    if (config.delayChannel) {
      const channelValue = ctx.state.channels[config.delayChannel];
      if (typeof channelValue === 'number' && channelValue > 0) {
        delay = channelValue;
      } else {
        logger.warn(
          { nodeId: ctx.node.id, delayChannel: config.delayChannel, channelValue },
          'Delay channel value is not a positive number, falling back to config.delayMs'
        );
      }
    }

    logger.info({ nodeId: ctx.node.id, delayMs: delay }, 'Delaying execution');

    await new Promise((resolve) => setTimeout(resolve, delay));

    return {
      stateUpdates: {},
      next: null,
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'delay',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { delayMs: delay },
        output: { delayed: true },
      },
    };
  }
}
