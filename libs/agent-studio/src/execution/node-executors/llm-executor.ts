import { jsonSchema, type ToolSet } from 'ai';
import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { LlmNodeConfig } from '../../types/nodes';
import { McpClientService } from '../../services/mcp-client.service';
import type { McpServerConfig } from '../../types/mcp-server';

const logger = createLogger('agent-studio:llm-executor');

export class LlmNodeExecutor implements NodeExecutor {
  type = 'llm';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as LlmNodeConfig;
    const startedAt = new Date().toISOString();
    const mcpClients: McpClientService[] = [];

    try {
      const provider = await ctx.services.llmProvider(undefined, config.model);

      let messages = ctx.state.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const contextChannels = config.contextChannels ?? [];
      const channelContents = contextChannels
        .map((ch) => ({ ch, content: ctx.state.channels[ch] }))
        .filter(
          (e): e is { ch: string; content: string } =>
            typeof e.content === 'string' && e.content.trim().length > 0,
        );

      if (channelContents.length > 0) {
        const lastUserIdx = messages.reduce<number>(
          (found, m, i) => (m.role === 'user' ? i : found),
          -1,
        );

        if (lastUserIdx !== -1) {
          const docBlock = channelContents
            .map((e, i) => `<document index="${i + 1}">\n${e.content}\n</document>`)
            .join('\n');
          const xmlBlock = `<documents>\n${docBlock}\n</documents>`;

          messages = [
            ...messages.slice(0, lastUserIdx),
            { ...messages[lastUserIdx], content: `${xmlBlock}\n\n${messages[lastUserIdx].content}` },
            ...messages.slice(lastUserIdx + 1),
          ];

          logger.debug(
            { nodeId: ctx.node.id, channels: contextChannels, docCount: channelContents.length },
            'injected context channels into last user message',
          );
        } else {
          logger.warn(
            { nodeId: ctx.node.id, channels: contextChannels },
            'contextChannels configured but no user message found to inject into — skipping',
          );
        }
      }

      // Resolve any configured built-in tool names against the execution tool registry.
      const tools: ToolSet = {};
      const registry = ctx.services.toolRegistry;
      const requestedTools = config.tools ?? [];
      const missingTools: string[] = [];
      for (const toolName of requestedTools) {
        const tool = registry?.[toolName];
        if (tool) {
          (tools as any)[toolName] = tool;
        } else {
          missingTools.push(toolName);
        }
      }
      if (missingTools.length > 0) {
        logger.warn(
          { nodeId: ctx.node.id, missingTools },
          'llm node references tools that are not in the registry',
        );
      }

      // Build MCP ToolSet if server IDs are configured
      const mcpServerIds = config.mcpServerIds ?? [];

      for (const serverId of mcpServerIds) {
        const server = await ctx.services.prisma.mcpServer.findFirst({ where: { id: serverId } });
        if (!server || server.status !== 'active') {
          logger.warn({ nodeId: ctx.node.id, serverId }, 'MCP server not found or not active — skipping');
          continue;
        }

        const serverConfig = server.config as McpServerConfig;
        const mcpClient = new McpClientService();
        mcpClients.push(mcpClient);

        const discovered = await mcpClient.discoverTools(serverConfig);
        logger.info(
          { nodeId: ctx.node.id, serverId, serverName: server.name, toolCount: discovered.length },
          'MCP tools discovered for LLM',
        );

        for (const tool of discovered) {
          const toolKey = `${server.name}__${tool.name}`;
          const capturedClient = mcpClient;
          const capturedToolName = tool.name;
          (tools as any)[toolKey] = {
            description: `[${server.name}] ${tool.description}`,
            inputSchema: jsonSchema({ ...tool.inputSchema, type: 'object' } as any),
            execute: async (args: Record<string, unknown>) =>
              capturedClient.executeTool(capturedToolName, args),
          };
        }
      }

      const hasTools = Object.keys(tools).length > 0;

      const streamResult = provider.streamChat({
        messages,
        model: config.model,
        system: config.systemPrompt,
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
        ...(hasTools ? { tools, maxSteps: 10 } : {}),
      });

      let fullText = '';
      for await (const chunk of streamResult.textStream) {
        fullText += chunk;
        ctx.emit({ type: 'text_delta', nodeId: ctx.node.id, delta: chunk });
      }

      logger.info(
        { nodeId: ctx.node.id, model: config.model, responseLength: fullText.length, mcpServers: mcpServerIds.length },
        'llm execution completed',
      );

      return {
        stateUpdates: { response: fullText },
        next: null,
        output: fullText,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'llm',
          nodeLabel: ctx.node.label,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { messageCount: messages.length, model: config.model, toolCount: Object.keys(tools).length },
          output: { responseLength: fullText.length },
        },
      };
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'llm execution failed');
      throw error;
    } finally {
      await Promise.all(mcpClients.map((c) => c.disconnect().catch(() => {})));
    }
  }
}
