import { Client } from '@modelcontextprotocol/sdk/client';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';
import { jsonSchema, type ToolSet } from 'ai';
import { createLogger } from '@chatbot/shared';
import type {
  McpServerConfig,
  SseTransportConfig,
  HttpBridgeTransportConfig,
} from '../types/mcp-server';

const logger = createLogger('agent-studio:mcp-client-service');

export interface McpDiscoveredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class McpClientService {
  private client: Client | null = null;
  private connected = false;

  async connect(config: McpServerConfig): Promise<void> {
    if (this.connected) return;

    this.client = new Client({ name: 'chatbot-agent', version: '1.0.0' });

    const transport = this.createTransport(config);
    const timeoutMs = config.timeoutMs ?? 30_000;

    await Promise.race([
      this.client.connect(transport),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`MCP connection timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);

    this.connected = true;
    logger.info({ transport: config.transport }, 'MCP client connected');
  }

  async discoverTools(config: McpServerConfig): Promise<McpDiscoveredTool[]> {
    await this.connect(config);

    const response = await this.client!.listTools();
    return (response.tools ?? []).map((t: any) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
    }));
  }

  async executeTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.connected || !this.client) {
      throw new Error('MCP client not connected. Call connect() first.');
    }

    const result = await this.client.callTool({ name: toolName, arguments: args });

    if (result.isError) {
      const errorText = Array.isArray(result.content)
        ? result.content.map((c: any) => c.text ?? '').join('\n')
        : String(result.content);
      throw new Error(`MCP tool "${toolName}" failed: ${errorText}`);
    }

    if (Array.isArray(result.content)) {
      const texts = result.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text);
      return texts.length === 1 ? texts[0] : texts.join('\n');
    }

    return result.content;
  }

  async disconnect(): Promise<void> {
    if (this.client && this.connected) {
      try {
        await this.client.close();
      } catch {
        // best-effort cleanup
      }
      this.connected = false;
      this.client = null;
    }
  }

  private createTransport(config: McpServerConfig) {
    switch (config.transport) {
      case 'sse': {
        const sseConfig = config.transportConfig as SseTransportConfig;
        return new SSEClientTransport(new URL(sseConfig.endpoint), {
          requestInit: sseConfig.headers
            ? { headers: sseConfig.headers }
            : undefined,
        });
      }
      case 'http_bridge': {
        const httpConfig = config.transportConfig as HttpBridgeTransportConfig;
        return new StreamableHTTPClientTransport(new URL(httpConfig.bridgeUrl));
      }
      default:
        throw new Error(`Unsupported MCP transport: ${config.transport}. Only 'sse' and 'http_bridge' are supported at runtime.`);
    }
  }
}

export async function buildMcpToolsForAgent(
  agentId: string,
  tenantId: string,
  db: any
): Promise<{ tools: ToolSet; cleanup: () => Promise<void> }> {
  const attachments = await db.agentMcpServer.findMany({
    where: { agentId },
    include: { mcpServer: true },
  });

  if (!attachments || attachments.length === 0) {
    return { tools: {}, cleanup: async () => {} };
  }

  const clients: McpClientService[] = [];
  const tools: ToolSet = {};

  for (const att of attachments) {
    const server = att.mcpServer;
    if (server.status !== 'active') continue;

    const config = server.config as McpServerConfig;
    const mcpClient = new McpClientService();

    try {
      const discovered = await mcpClient.discoverTools(config);
      clients.push(mcpClient);

      for (const t of discovered) {
        const namespaced = `${server.name}__${t.name}`;
        const capturedClient = mcpClient;
        const capturedToolName = t.name;
        (tools as any)[namespaced] = {
          description: `[${server.name}] ${t.description}`,
          parameters: jsonSchema(t.inputSchema as any),
          execute: async (args: any) => {
            return capturedClient.executeTool(capturedToolName, args as Record<string, unknown>);
          },
        };
      }

      logger.info(
        { serverId: server.id, serverName: server.name, toolCount: discovered.length },
        'Discovered MCP tools'
      );
    } catch (err) {
      logger.error(
        { serverId: server.id, serverName: server.name, err },
        'Failed to connect to MCP server — skipping'
      );
    }
  }

  const cleanup = async () => {
    await Promise.allSettled(clients.map((c) => c.disconnect()));
  };

  return { tools, cleanup };
}
