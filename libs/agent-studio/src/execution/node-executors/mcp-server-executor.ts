import pino from 'pino';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { McpServerNodeConfig } from '../../types/nodes';

const logger = pino({ name: 'mcp-server-executor' });

export class McpServerNodeExecutor implements NodeExecutor {
  type = 'mcp_server';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as McpServerNodeConfig;
    const startedAt = new Date().toISOString();

    let args: Record<string, unknown> = {};
    if (config.argumentSource === 'static') {
      args = config.staticArguments ?? {};
    } else if (config.channelMappings) {
      for (const [param, channel] of Object.entries(config.channelMappings)) {
        args[param] = ctx.state.channels[channel] ?? null;
      }
    }

    logger.warn(
      { nodeId: ctx.node.id, serverId: config.serverId, toolName: config.toolName },
      'MCP execution not yet implemented — returning null'
    );

    return {
      stateUpdates: { [config.outputChannel]: null },
      next: null,
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'mcp_server',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { serverId: config.serverId, toolName: config.toolName, arguments: args },
        output: undefined,
      },
    };
  }
}
