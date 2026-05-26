import { createLogger } from '@chatbot/shared';
import type {
  McpServer,
  McpServerStatus,
  CreateMcpServerInput,
  UpdateMcpServerInput,
  McpServerFilters,
} from '../types/mcp-server';

const logger = createLogger('agent-studio:mcp-server-service');

export interface McpServerPrismaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  findFirst(args: {
    where: Record<string, unknown>;
    include?: Record<string, unknown>;
  }): Promise<unknown | null>;
  findMany(args: {
    where: Record<string, unknown>;
    skip?: number;
    take?: number;
    orderBy?: Record<string, unknown>;
    include?: Record<string, unknown>;
  }): Promise<unknown[]>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<unknown>;
  delete(args: { where: Record<string, unknown> }): Promise<unknown>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

export interface AgentMcpServerPrismaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  findMany(args: {
    where: Record<string, unknown>;
    include?: Record<string, unknown>;
  }): Promise<unknown[]>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
}

export interface McpServerDb {
  mcpServer: McpServerPrismaDelegate;
  agentMcpServer: AgentMcpServerPrismaDelegate;
}

export class McpServerService {
  constructor(
    private readonly tenantId: string,
    private readonly db: McpServerDb
  ) {}

  async create(input: CreateMcpServerInput) {
    try {
      logger.info({ tenantId: this.tenantId, name: input.name, transport: input.transport }, 'Creating MCP server');
      const result = await this.db.mcpServer.create({
        data: {
          tenantId: this.tenantId,
          name: input.name,
          description: input.description ?? null,
          transport: input.transport,
          config: input.config as unknown as Record<string, unknown>,
          status: 'active' satisfies McpServerStatus,
        },
      });
      logger.info({ tenantId: this.tenantId, mcpServerId: (result as McpServer).id }, 'MCP server created');
      return result as McpServer;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, error, name: input.name }, 'Failed to create MCP server');
      throw error;
    }
  }

  async findById(id: string) {
    try {
      logger.debug({ tenantId: this.tenantId, mcpServerId: id }, 'Finding MCP server by id');
      const result = await this.db.mcpServer.findFirst({
        where: { id, tenantId: this.tenantId },
      });
      logger.debug({ tenantId: this.tenantId, mcpServerId: id, found: !!result }, 'MCP server findById complete');
      return result as McpServer | null;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, mcpServerId: id, error }, 'Failed to find MCP server');
      throw error;
    }
  }

  async findByIdWithVersions(id: string) {
    try {
      logger.debug({ tenantId: this.tenantId, mcpServerId: id }, 'Finding MCP server with versions');
      const result = await this.db.mcpServer.findFirst({
        where: { id, tenantId: this.tenantId },
        include: { versions: { orderBy: { version: 'desc' } } },
      });
      logger.debug({ tenantId: this.tenantId, mcpServerId: id, found: !!result }, 'MCP server findByIdWithVersions complete');
      return result as (McpServer & { versions: unknown[] }) | null;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, mcpServerId: id, error }, 'Failed to find MCP server with versions');
      throw error;
    }
  }

  async findMany(filters: Omit<McpServerFilters, 'tenantId'> = {}) {
    try {
      const { status, transport, search, page = 1, pageSize = 20 } = filters;
      logger.debug({ tenantId: this.tenantId, status, transport, search, page, pageSize }, 'Listing MCP servers');
      const where: Record<string, unknown> = { tenantId: this.tenantId };

      if (status) where['status'] = status;
      if (transport) where['transport'] = transport;
      if (search) {
        where['OR'] = [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ];
      }

      const skip = (page - 1) * pageSize;
      const [items, total] = await Promise.all([
        this.db.mcpServer.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: { updatedAt: 'desc' },
          include: { _count: { select: { versions: true } } },
        }),
        this.db.mcpServer.count({ where }),
      ]);

      logger.info({ tenantId: this.tenantId, total, page, pageSize }, 'MCP server list complete');
      return { items: items as McpServer[], total, page, pageSize };
    } catch (error) {
      logger.error({ tenantId: this.tenantId, error, filters }, 'Failed to list MCP servers');
      throw error;
    }
  }

  async update(id: string, input: UpdateMcpServerInput) {
    try {
      logger.info({ tenantId: this.tenantId, mcpServerId: id, fields: Object.keys(input) }, 'Updating MCP server');
      const result = await this.db.mcpServer.update({
        where: { id, tenantId: this.tenantId },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.transport !== undefined && { transport: input.transport }),
          ...(input.config !== undefined && {
            config: input.config as unknown as Record<string, unknown>,
          }),
        },
      });
      logger.info({ tenantId: this.tenantId, mcpServerId: id }, 'MCP server updated');
      return result as McpServer;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, mcpServerId: id, error }, 'Failed to update MCP server');
      throw error;
    }
  }

  async delete(id: string) {
    try {
      logger.info({ tenantId: this.tenantId, mcpServerId: id }, 'Deleting MCP server');
      await this.db.agentMcpServer.deleteMany({
        where: { mcpServerId: id },
      });
      const result = await this.db.mcpServer.delete({
        where: { id, tenantId: this.tenantId },
      });
      logger.info({ tenantId: this.tenantId, mcpServerId: id }, 'MCP server deleted');
      return result;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, mcpServerId: id, error }, 'Failed to delete MCP server');
      throw error;
    }
  }

  async updateStatus(id: string, status: McpServerStatus) {
    return this.update(id, { status } as UpdateMcpServerInput);
  }
}
