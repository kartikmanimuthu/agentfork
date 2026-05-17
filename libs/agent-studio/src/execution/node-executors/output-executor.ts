import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { OutputNodeConfig } from '../../types/nodes';

export class OutputNodeExecutor implements NodeExecutor {
  type = 'output';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as OutputNodeConfig;
    const startedAt = new Date().toISOString();

    const channelValue = ctx.state.channels[config.responseChannel];
    const content = typeof channelValue === 'string'
      ? channelValue
      : JSON.stringify(channelValue ?? '');

    if (config.format === 'text' || config.format === 'stream') {
      ctx.emit({ type: 'text_delta', nodeId: ctx.node.id, delta: content });
    }

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
  }
}
