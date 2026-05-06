import type { McpServerVersion, McpServerConfig } from '../types/mcp-server';

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
    const count = await this.db.mcpServerVersion.count({
      where: { mcpServerId },
    });

    return this.db.mcpServerVersion.create({
      data: {
        mcpServerId,
        version: count + 1,
        config: config as unknown as Record<string, unknown>,
        changeNotes: changeNotes ?? null,
      },
    }) as Promise<McpServerVersion>;
  }

  async findById(id: string) {
    const result = await this.db.mcpServerVersion.findFirst({
      where: { id },
    });
    return result as McpServerVersion | null;
  }

  async findByMcpServerId(mcpServerId: string) {
    const result = await this.db.mcpServerVersion.findMany({
      where: { mcpServerId },
      orderBy: { version: 'desc' },
    });
    return result as McpServerVersion[];
  }
}
