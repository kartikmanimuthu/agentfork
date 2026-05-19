import { createLogger } from '@chatbot/shared';
import type { AgentVersionStatus } from '../types/agent';
import type { SimpleAgentConfig, GraphDefinition } from '../types/agent';

const logger = createLogger('agent-studio:agent-version-service');

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
    try {
      logger.info({ agentId }, 'Creating agent version');
      const count = await this.db.agentVersion.count({ where: { agentId } });

      const result = await this.db.agentVersion.create({
        data: {
          agentId,
          version: count + 1,
          config: config as unknown as Record<string, unknown>,
          status: 'draft' satisfies AgentVersionStatus,
        },
      });
      logger.info({ agentId, versionId: (result as { id: string }).id, version: count + 1 }, 'Agent version created');
      return result;
    } catch (error) {
      logger.error({ agentId, error }, 'Failed to create agent version');
      throw error;
    }
  }

  async findById(id: string) {
    try {
      logger.debug({ versionId: id }, 'Finding agent version by id');
      const result = await this.db.agentVersion.findFirst({ where: { id } });
      logger.debug({ versionId: id, found: !!result }, 'Agent version findById complete');
      return result;
    } catch (error) {
      logger.error({ versionId: id, error }, 'Failed to find agent version');
      throw error;
    }
  }

  async findByAgentId(agentId: string) {
    try {
      logger.debug({ agentId }, 'Listing agent versions');
      const result = await this.db.agentVersion.findMany({
        where: { agentId },
        orderBy: { version: 'desc' },
      });
      logger.info({ agentId, count: result.length }, 'Agent version list complete');
      return result;
    } catch (error) {
      logger.error({ agentId, error }, 'Failed to list agent versions');
      throw error;
    }
  }

  async publish(id: string) {
    try {
      logger.info({ versionId: id }, 'Publishing agent version');
      const result = await this.db.agentVersion.update({
        where: { id },
        data: { status: 'published' satisfies AgentVersionStatus },
      });
      logger.info({ versionId: id }, 'Agent version published');
      return result;
    } catch (error) {
      logger.error({ versionId: id, error }, 'Failed to publish agent version');
      throw error;
    }
  }

  async archive(id: string) {
    try {
      logger.info({ versionId: id }, 'Archiving agent version');
      const result = await this.db.agentVersion.update({
        where: { id },
        data: { status: 'archived' satisfies AgentVersionStatus },
      });
      logger.info({ versionId: id }, 'Agent version archived');
      return result;
    } catch (error) {
      logger.error({ versionId: id, error }, 'Failed to archive agent version');
      throw error;
    }
  }
}
