import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { ToolNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:tool-executor');

export class ToolNodeExecutor implements NodeExecutor {
  type = 'tool';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as ToolNodeConfig;
    const startedAt = new Date().toISOString();
    const outputChannel = `${config.toolName}_result`;

    try {
      const registry = ctx.services.toolRegistry;
      const tool = registry?.[config.toolName] as
        | { execute?: (input: unknown, options: unknown) => Promise<unknown> }
        | undefined;

      if (!tool || typeof tool.execute !== 'function') {
        const available = registry ? Object.keys(registry) : [];
        throw new Error(
          `Tool "${config.toolName}" is not available. Configured tools: ${available.length ? available.join(', ') : 'none'}`,
        );
      }

      const parameters = config.parameters ?? {};

      logger.info(
        { nodeId: ctx.node.id, toolName: config.toolName },
        'tool execution started',
      );

      // Vercel AI SDK ToolSet entries expose execute(args, options).
      const result = await tool.execute(parameters, {});

      logger.info(
        { nodeId: ctx.node.id, toolName: config.toolName },
        'tool execution completed',
      );

      return {
        stateUpdates: { [outputChannel]: result, tool_result: result },
        next: null,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'tool',
          nodeLabel: ctx.node.label,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { toolName: config.toolName, parameters },
          output: { result } as Record<string, unknown>,
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(
        { nodeId: ctx.node.id, toolName: config.toolName, err },
        'tool execution failed',
      );

      return {
        stateUpdates: { [outputChannel]: null, tool_result: null },
        next: null,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'tool',
          nodeLabel: ctx.node.label,
          status: 'failed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { toolName: config.toolName, parameters: config.parameters },
          error: errorMessage,
        },
      };
    }
  }
}
