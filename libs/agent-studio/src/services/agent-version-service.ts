import type { AgentVersionStatus } from '../types/agent';
import type { SimpleAgentConfig, GraphDefinition } from '../types/agent';

export interface AgentVersionPrismaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
  }): Promise<unknown[]>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<unknown>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

export interface AgentVersionDb {
  agentVersion: AgentVersionPrismaDelegate;
}

export class AgentVersionService {
  constructor(private readonly db: AgentVersionDb) {}

  async create(agentId: string, config: SimpleAgentConfig | GraphDefinition) {
    // Determine the next version number
    const count = await this.db.agentVersion.count({ where: { agentId } });

    return this.db.agentVersion.create({
      data: {
        agentId,
        version: count + 1,
        config: config as unknown as Record<string, unknown>,
        status: 'draft' satisfies AgentVersionStatus,
      },
    });
  }

  async findById(id: string) {
    return this.db.agentVersion.findFirst({ where: { id } });
  }

  async findByAgentId(agentId: string) {
    return this.db.agentVersion.findMany({
      where: { agentId },
      orderBy: { version: 'desc' },
    });
  }

  async publish(id: string) {
    return this.db.agentVersion.update({
      where: { id },
      data: { status: 'published' satisfies AgentVersionStatus },
    });
  }

  async archive(id: string) {
    return this.db.agentVersion.update({
      where: { id },
      data: { status: 'archived' satisfies AgentVersionStatus },
    });
  }
}
