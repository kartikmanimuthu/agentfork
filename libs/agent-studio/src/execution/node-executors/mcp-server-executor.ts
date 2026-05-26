import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { McpServerNodeConfig } from '../../types/nodes';
import { McpClientService } from '../../services/mcp-client.service';
import type { McpServerConfig } from '../../types/mcp-server';

const logger = createLogger('agent-studio:mcp-server-executor');

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

    const mcpClient = new McpClientService();
    let result: unknown = null;

    try {
      const server = await ctx.services.prisma.mcpServer.findFirst({
        where: { id: config.serverId },
      });

      if (!server) {
        throw new Error(`MCP server not found: ${config.serverId}`);
      }

      if (server.status !== 'active') {
        throw new Error(`MCP server "${server.name}" is not active (status: ${server.status})`);
      }

      const serverConfig = server.config as McpServerConfig;
      await mcpClient.connect(serverConfig);
      result = await mcpClient.executeTool(config.toolName, args);

      logger.info(
        { nodeId: ctx.node.id, serverId: config.serverId, toolName: config.toolName },
        'MCP tool executed successfully'
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(
        { nodeId: ctx.node.id, serverId: config.serverId, toolName: config.toolName, err },
        'MCP tool execution failed'
      );

      return {
        stateUpdates: { [config.outputChannel]: null },
        next: null,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'mcp_server',
          nodeLabel: ctx.node.label,
          status: 'failed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { serverId: config.serverId, toolName: config.toolName, arguments: args },
          output: undefined,
          error: errorMessage,
        },
      };
    } finally {
      await mcpClient.disconnect();
    }

    return {
      stateUpdates: { [config.outputChannel]: result },
      next: null,
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'mcp_server',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { serverId: config.serverId, toolName: config.toolName, arguments: args },
        output: { result } as Record<string, unknown>,
      },
    };
  }
}
