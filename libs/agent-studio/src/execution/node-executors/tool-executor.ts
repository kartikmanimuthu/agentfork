import pino from 'pino';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { ToolNodeConfig } from '../../types/nodes';

const logger = pino({ name: 'tool-executor' });

export class ToolNodeExecutor implements NodeExecutor {
  type = 'tool';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as ToolNodeConfig;
    const startedAt = new Date().toISOString();

    logger.warn(
      { nodeId: ctx.node.id, toolName: config.toolName },
      'tool execution not yet implemented, returning empty result',
    );

    return {
      stateUpdates: { tool_result: null },
      next: null,
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'tool',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { toolName: config.toolName, parameters: config.parameters },
        output: { result: null },
      },
    };
  }
}
