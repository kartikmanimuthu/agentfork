import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { McpServerNodeConfig } from '../../types/nodes';
import { McpClientService } from '../../services/mcp-client.service';
import type { McpServerConfig } from '../../types/mcp-server';

const logger = createLogger('agent-studio:mcp-server-executor');

const MAX_ALL_MODE_TOOLS = 20;

export class McpServerNodeExecutor implements NodeExecutor {
  type = 'mcp_server';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as McpServerNodeConfig;
    const startedAt = new Date().toISOString();
    const toolMode = config.toolMode ?? 'single';

    const args: Record<string, unknown> = {};
    if (config.argumentSource === 'static') {
      Object.assign(args, config.staticArguments ?? {});
    } else if (config.channelMappings) {
      for (const [param, channel] of Object.entries(config.channelMappings)) {
        args[param] = ctx.state.channels[channel] ?? null;
      }
    }

    const mcpClient = new McpClientService();

    try {
      const server = await ctx.services.prisma.mcpServer.findFirst({
        where: { OR: [{ id: config.serverId }, { name: config.serverId }] },
      });

      if (!server) throw new Error(`MCP server not found: ${config.serverId}`);
      if (server.status !== 'active') {
        throw new Error(`MCP server "${server.name}" is not active (status: ${server.status})`);
      }

      const serverConfig = server.config as McpServerConfig;
      await mcpClient.connect(serverConfig);

      let stateValue: string;

      if (toolMode === 'single') {
        if (!config.toolName) throw new Error('toolName is required in single mode');
        const result = await mcpClient.executeTool(config.toolName, args);
        stateValue = String(result);
        logger.info(
          { nodeId: ctx.node.id, serverId: config.serverId, toolName: config.toolName },
          'MCP tool executed successfully',
        );
      } else if (toolMode === 'selected') {
        const toolNames = config.toolNames ?? [];
        if (toolNames.length === 0) throw new Error('toolNames must not be empty in selected mode');
        const results: Record<string, unknown> = {};
        for (const toolName of toolNames) {
          results[toolName] = await mcpClient.executeTool(toolName, args);
          logger.info(
            { nodeId: ctx.node.id, serverId: config.serverId, toolName },
            'MCP tool executed successfully',
          );
        }
        stateValue = JSON.stringify(results);
      } else {
        // all mode
        const discovered = await mcpClient.discoverTools(serverConfig);
        if (discovered.length > MAX_ALL_MODE_TOOLS) {
          throw new Error(
            `MCP server "${server.name}" exposes ${discovered.length} tools but 'all' mode is capped at ${MAX_ALL_MODE_TOOLS}. Use 'selected' mode to pick specific tools.`,
          );
        }
        const results: Record<string, unknown> = {};
        for (const tool of discovered) {
          results[tool.name] = await mcpClient.executeTool(tool.name, args);
          logger.info(
            { nodeId: ctx.node.id, serverId: config.serverId, toolName: tool.name },
            'MCP tool executed successfully',
          );
        }
        stateValue = JSON.stringify(results);
      }

      return {
        stateUpdates: { [config.outputChannel]: stateValue },
        next: null,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'mcp_server',
          nodeLabel: ctx.node.label,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { serverId: config.serverId, toolMode, arguments: args },
          output: { outputChannel: config.outputChannel } as Record<string, unknown>,
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(
        { nodeId: ctx.node.id, serverId: config.serverId, toolMode, err },
        'MCP tool execution failed',
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
          input: { serverId: config.serverId, toolMode, arguments: args },
          output: undefined,
          error: errorMessage,
        },
      };
    } finally {
      await mcpClient.disconnect();
    }
  }
}
