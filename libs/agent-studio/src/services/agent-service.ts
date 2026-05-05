import type {
  CreateAgentInput,
  UpdateAgentInput,
  AgentFilters,
  AgentStatus,
} from '../types/agent';

// Minimal Prisma delegate interface — will be satisfied by the real PrismaClient
// once the Agent model is added in Task 5.
export interface AgentPrismaDelegate {
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

export interface AgentDb {
  agent: AgentPrismaDelegate;
}

export class AgentService {
  constructor(
    private readonly tenantId: string,
    private readonly db: AgentDb
  ) {}

  async create(input: CreateAgentInput) {
    return this.db.agent.create({
      data: {
        tenantId: this.tenantId,
        name: input.name,
        description: input.description ?? null,
        type: input.type,
        status: 'draft' satisfies AgentStatus,
        config: input.config as unknown as Record<string, unknown>,
      },
    });
  }

  async findById(id: string) {
    return this.db.agent.findFirst({
      where: { id, tenantId: this.tenantId },
    });
  }

  async findMany(filters: Omit<AgentFilters, 'tenantId'> = {}) {
    const { status, type, search, page = 1, pageSize = 20 } = filters;
    const where: Record<string, unknown> = { tenantId: this.tenantId };

    if (status) where['status'] = status;
    if (type) where['type'] = type;
    if (search) {
      where['OR'] = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.db.agent.findMany({ where, skip, take: pageSize, orderBy: { updatedAt: 'desc' } }),
      this.db.agent.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async update(id: string, input: UpdateAgentInput) {
    return this.db.agent.update({
      where: { id, tenantId: this.tenantId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.config !== undefined && { config: input.config as unknown as Record<string, unknown> }),
      },
    });
  }

  async delete(id: string) {
    return this.db.agent.delete({
      where: { id, tenantId: this.tenantId },
    });
  }

  async updateStatus(id: string, status: AgentStatus) {
    return this.update(id, { status });
  }
}
