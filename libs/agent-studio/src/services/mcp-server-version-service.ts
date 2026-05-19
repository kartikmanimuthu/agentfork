import { createLogger } from '@chatbot/shared';
import type { McpServerVersion, McpServerConfig } from '../types/mcp-server';

const logger = createLogger('agent-studio:mcp-server-version-service');

export interface McpServerVersionPrismaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
  }): Promise<unknown[]>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

export interface McpServerVersionDb {
  mcpServerVersion: McpServerVersionPrismaDelegate;
}

export class McpServerVersionService {
  constructor(private readonly db: McpServerVersionDb) {}

  async create(mcpServerId: string, config: McpServerConfig, changeNotes?: string) {
    try {
      logger.info({ mcpServerId, changeNotes }, 'Creating MCP server version');
      const count = await this.db.mcpServerVersion.count({
        where: { mcpServerId },
      });

      const result = await this.db.mcpServerVersion.create({
        data: {
          mcpServerId,
          version: count + 1,
          config: config as unknown as Record<string, unknown>,
          changeNotes: changeNotes ?? null,
        },
      }) as McpServerVersion;
      logger.info({ mcpServerId, versionId: result.id, version: count + 1 }, 'MCP server version created');
      return result;
    } catch (error) {
      logger.error({ mcpServerId, error }, 'Failed to create MCP server version');
      throw error;
    }
  }

  async findById(id: string) {
    try {
      logger.debug({ versionId: id }, 'Finding MCP server version by id');
      const result = await this.db.mcpServerVersion.findFirst({
        where: { id },
      });
      logger.debug({ versionId: id, found: !!result }, 'MCP server version findById complete');
      return result as McpServerVersion | null;
    } catch (error) {
      logger.error({ versionId: id, error }, 'Failed to find MCP server version');
      throw error;
    }
  }

  async findByMcpServerId(mcpServerId: string) {
    try {
      logger.debug({ mcpServerId }, 'Listing MCP server versions');
      const result = await this.db.mcpServerVersion.findMany({
        where: { mcpServerId },
        orderBy: { version: 'desc' },
      });
      logger.info({ mcpServerId, count: result.length }, 'MCP server version list complete');
      return result as McpServerVersion[];
    } catch (error) {
      logger.error({ mcpServerId, error }, 'Failed to list MCP server versions');
      throw error;
    }
  }
}
