import { createLogger } from '@chatbot/shared';
import type {
  CreateAgentInput,
  UpdateAgentInput,
  AgentFilters,
  AgentStatus,
} from '../types/agent';

const logger = createLogger('agent-studio:agent-service');

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
    try {
      logger.info({ tenantId: this.tenantId, name: input.name, type: input.type }, 'Creating agent');
      const result = await this.db.agent.create({
        data: {
          tenantId: this.tenantId,
          name: input.name,
          description: input.description ?? null,
          type: input.type,
          status: 'draft' satisfies AgentStatus,
          config: input.config as unknown as Record<string, unknown>,
        },
      });
      logger.info({ tenantId: this.tenantId, agentId: (result as { id: string }).id }, 'Agent created');
      return result;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, error, name: input.name }, 'Failed to create agent');
      throw error;
    }
  }

  async findById(id: string) {
    try {
      logger.debug({ tenantId: this.tenantId, agentId: id }, 'Finding agent by id');
      const result = await this.db.agent.findFirst({
        where: { id, tenantId: this.tenantId },
      });
      logger.debug({ tenantId: this.tenantId, agentId: id, found: !!result }, 'Agent findById complete');
      return result;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, agentId: id, error }, 'Failed to find agent');
      throw error;
    }
  }

  async findMany(filters: Omit<AgentFilters, 'tenantId'> = {}) {
    try {
      const { status, type, search, page = 1, pageSize = 20 } = filters;
      logger.debug({ tenantId: this.tenantId, status, type, search, page, pageSize }, 'Listing agents');
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

      logger.info({ tenantId: this.tenantId, total, page, pageSize }, 'Agent list complete');
      return { items, total, page, pageSize };
    } catch (error) {
      logger.error({ tenantId: this.tenantId, error, filters }, 'Failed to list agents');
      throw error;
    }
  }

  async update(id: string, input: UpdateAgentInput) {
    try {
      logger.info({ tenantId: this.tenantId, agentId: id, fields: Object.keys(input) }, 'Updating agent');
      const result = await this.db.agent.update({
        where: { id, tenantId: this.tenantId },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.status !== undefined && { status: input.status }),
          ...(input.config !== undefined && { config: input.config as unknown as Record<string, unknown> }),
        },
      });
      logger.info({ tenantId: this.tenantId, agentId: id }, 'Agent updated');
      return result;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, agentId: id, error }, 'Failed to update agent');
      throw error;
    }
  }

  async delete(id: string) {
    try {
      logger.info({ tenantId: this.tenantId, agentId: id }, 'Deleting agent');
      const result = await this.db.agent.delete({
        where: { id, tenantId: this.tenantId },
      });
      logger.info({ tenantId: this.tenantId, agentId: id }, 'Agent deleted');
      return result;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, agentId: id, error }, 'Failed to delete agent');
      throw error;
    }
  }

  async updateStatus(id: string, status: AgentStatus) {
    return this.update(id, { status });
  }
}
