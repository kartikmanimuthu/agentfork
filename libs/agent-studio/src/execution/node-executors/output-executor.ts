import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { OutputNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:output-executor');

export class OutputNodeExecutor implements NodeExecutor {
  type = 'output';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as OutputNodeConfig;
    const startedAt = new Date().toISOString();

    try {
      const channelValue = ctx.state.channels[config.responseChannel];
      const content = this.formatContent(config.format, channelValue, ctx);

      logger.info(
        { nodeId: ctx.node.id, format: config.format, contentLength: content.length },
        'output node executed',
      );

      return {
        stateUpdates: { __output: content },
        next: null,
        output: content,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'output',
          nodeLabel: ctx.node.label,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { responseChannel: config.responseChannel, format: config.format },
          output: { contentLength: content.length },
        },
      };
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'output node execution failed');
      throw error;
    }
  }

  private formatContent(
    format: OutputNodeConfig['format'],
    channelValue: unknown,
    ctx: NodeExecutionContext,
  ): string {
    switch (format) {
      case 'json': {
        const serialized = JSON.stringify(channelValue ?? null);
        return serialized;
      }

      case 'stream': {
        const content = typeof channelValue === 'string'
          ? channelValue
          : JSON.stringify(channelValue ?? '');
        ctx.emit({ type: 'text_delta', nodeId: ctx.node.id, delta: content });
        return content;
      }

      case 'text':
      default:
        return typeof channelValue === 'string'
          ? channelValue
          : JSON.stringify(channelValue ?? '');
    }
  }
}
