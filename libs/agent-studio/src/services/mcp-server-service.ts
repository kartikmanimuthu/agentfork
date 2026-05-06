import type {
  McpServer,
  McpServerStatus,
  CreateMcpServerInput,
  UpdateMcpServerInput,
  McpServerFilters,
} from '../types/mcp-server';

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
    return result as McpServer;
  }

  async findById(id: string) {
    const result = await this.db.mcpServer.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    return result as McpServer | null;
  }

  async findByIdWithVersions(id: string) {
    const result = await this.db.mcpServer.findFirst({
      where: { id, tenantId: this.tenantId },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    return result as (McpServer & { versions: unknown[] }) | null;
  }

  async findMany(filters: Omit<McpServerFilters, 'tenantId'> = {}) {
    const { status, transport, search, page = 1, pageSize = 20 } = filters;
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

    return { items: items as McpServer[], total, page, pageSize };
  }

  async update(id: string, input: UpdateMcpServerInput) {
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
    return result as McpServer;
  }

  async delete(id: string) {
    await this.db.agentMcpServer.deleteMany({
      where: { mcpServerId: id },
    });
    return this.db.mcpServer.delete({
      where: { id, tenantId: this.tenantId },
    });
  }

  async updateStatus(id: string, status: McpServerStatus) {
    return this.update(id, { status } as UpdateMcpServerInput);
  }
}
