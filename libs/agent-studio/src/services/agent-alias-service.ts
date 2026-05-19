import { createLogger } from '@chatbot/shared';
import type { AgentAlias } from '../types/alias';

const logger = createLogger('agent-studio:agent-alias-service');

export interface AgentAliasPrismaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  findFirst(args: { where: Record<string, unknown>; include?: Record<string, unknown> }): Promise<unknown | null>;
  findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown>; take?: number; include?: Record<string, unknown> }): Promise<unknown[]>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
  delete(args: { where: Record<string, unknown> }): Promise<unknown>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

export interface AgentVersionPrismaDelegate {
  findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
}

export interface AgentAliasDb {
  agentAlias: AgentAliasPrismaDelegate;
  agentVersion: AgentVersionPrismaDelegate;
}

export class AgentAliasService {
  constructor(
    private readonly tenantId: string,
    private readonly db: AgentAliasDb
  ) {}

  async createAlias(agentId: string, name: string, versionId: string, isDefault?: boolean) {
    try {
      logger.info({ tenantId: this.tenantId, agentId, name, versionId }, 'Creating agent alias');
      // Verify version exists and belongs to agent
      const version = await this.db.agentVersion.findFirst({
        where: { id: versionId, agentId },
      });
      if (!version) {
        logger.warn({ tenantId: this.tenantId, agentId, versionId }, 'Version not found for this agent');
        throw new Error('Version not found for this agent');
      }

      // If this is the first alias for the agent, make it default
      const aliasCount = await this.db.agentAlias.count({ where: { agentId } });
      const shouldBeDefault = isDefault ?? aliasCount === 0;

      if (shouldBeDefault) {
        await this.clearOtherDefaults(agentId);
      }

      const result = await this.db.agentAlias.create({
        data: {
          agentId,
          name,
          versionId,
          isDefault: shouldBeDefault,
        },
      }) as AgentAlias;
      logger.info({ tenantId: this.tenantId, agentId, aliasId: result.id, name }, 'Agent alias created');
      return result;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, agentId, name, versionId, error }, 'Failed to create agent alias');
      throw error;
    }
  }

  async findByAgentId(agentId: string) {
    try {
      logger.debug({ tenantId: this.tenantId, agentId }, 'Listing agent aliases');
      const result = await this.db.agentAlias.findMany({
        where: { agentId },
        orderBy: { createdAt: 'asc' },
        include: { version: { select: { version: true, status: true } } },
      }) as (AgentAlias & { version: { version: number; status: string } })[];
      logger.info({ tenantId: this.tenantId, agentId, count: result.length }, 'Agent alias list complete');
      return result;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, agentId, error }, 'Failed to list agent aliases');
      throw error;
    }
  }

  async updateAlias(id: string, updates: { versionId?: string; isDefault?: boolean }) {
    try {
      logger.info({ tenantId: this.tenantId, aliasId: id, fields: Object.keys(updates) }, 'Updating agent alias');
      if (updates.isDefault) {
        const alias = await this.db.agentAlias.findFirst({ where: { id } }) as AgentAlias | null;
        if (alias) {
          await this.clearOtherDefaults(alias.agentId);
        }
      }

      const result = await this.db.agentAlias.update({
        where: { id },
        data: {
          ...(updates.versionId !== undefined && { versionId: updates.versionId }),
          ...(updates.isDefault !== undefined && { isDefault: updates.isDefault }),
        },
      }) as AgentAlias;
      logger.info({ tenantId: this.tenantId, aliasId: id }, 'Agent alias updated');
      return result;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, aliasId: id, error }, 'Failed to update agent alias');
      throw error;
    }
  }

  async deleteAlias(id: string) {
    try {
      logger.info({ tenantId: this.tenantId, aliasId: id }, 'Deleting agent alias');
      const alias = await this.db.agentAlias.findFirst({ where: { id } }) as AgentAlias | null;
      if (!alias) {
        logger.warn({ tenantId: this.tenantId, aliasId: id }, 'Alias not found');
        throw new Error('Alias not found');
      }

      await this.db.agentAlias.delete({ where: { id } });

      // If deleted alias was default, set the oldest remaining as default
      if (alias.isDefault) {
        const remaining = await this.db.agentAlias.findMany({
          where: { agentId: alias.agentId },
          orderBy: { createdAt: 'asc' },
          take: 1,
        }) as AgentAlias[];

        if (remaining.length > 0) {
          await this.db.agentAlias.update({
            where: { id: remaining[0].id },
            data: { isDefault: true },
          });
        }
      }
      logger.info({ tenantId: this.tenantId, aliasId: id }, 'Agent alias deleted');
    } catch (error) {
      logger.error({ tenantId: this.tenantId, aliasId: id, error }, 'Failed to delete agent alias');
      throw error;
    }
  }

  async resolveAlias(agentId: string, aliasName?: string) {
    try {
      logger.debug({ tenantId: this.tenantId, agentId, aliasName }, 'Resolving agent alias');
      const alias = aliasName
        ? await this.db.agentAlias.findFirst({
            where: { agentId, name: aliasName },
            include: { version: true },
          })
        : await this.db.agentAlias.findFirst({
            where: { agentId, isDefault: true },
            include: { version: true },
          });

      if (!alias) {
        logger.warn({ tenantId: this.tenantId, agentId, aliasName }, aliasName ? 'Alias not found' : 'No default alias configured');
        throw new Error(aliasName ? `Alias '${aliasName}' not found` : 'No default alias configured');
      }

      const { version } = alias as { version: { id: string; config: unknown } };
      logger.info({ tenantId: this.tenantId, agentId, aliasId: (alias as AgentAlias).id, versionId: version.id }, 'Alias resolved');
      return {
        aliasId: (alias as AgentAlias).id,
        aliasName: (alias as AgentAlias).name,
        versionId: version.id,
        config: version.config as Record<string, unknown>,
      };
    } catch (error) {
      logger.error({ tenantId: this.tenantId, agentId, aliasName, error }, 'Failed to resolve alias');
      throw error;
    }
  }

  private async clearOtherDefaults(agentId: string) {
    try {
      logger.debug({ tenantId: this.tenantId, agentId }, 'Clearing other default aliases');
      const defaults = await this.db.agentAlias.findMany({
        where: { agentId, isDefault: true },
      }) as AgentAlias[];

      for (const d of defaults) {
        await this.db.agentAlias.update({
          where: { id: d.id },
          data: { isDefault: false },
        });
      }
    } catch (error) {
      logger.error({ tenantId: this.tenantId, agentId, error }, 'Failed to clear other default aliases');
      throw error;
    }
  }
}
