import type { AgentAlias } from '../types/alias';

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
    // Verify version exists and belongs to agent
    const version = await this.db.agentVersion.findFirst({
      where: { id: versionId, agentId },
    });
    if (!version) {
      throw new Error('Version not found for this agent');
    }

    // If this is the first alias for the agent, make it default
    const aliasCount = await this.db.agentAlias.count({ where: { agentId } });
    const shouldBeDefault = isDefault ?? aliasCount === 0;

    if (shouldBeDefault) {
      await this.clearOtherDefaults(agentId);
    }

    return this.db.agentAlias.create({
      data: {
        agentId,
        name,
        versionId,
        isDefault: shouldBeDefault,
      },
    }) as Promise<AgentAlias>;
  }

  async findByAgentId(agentId: string) {
    return this.db.agentAlias.findMany({
      where: { agentId },
      orderBy: { createdAt: 'asc' },
      include: { version: { select: { version: true, status: true } } },
    }) as Promise<(AgentAlias & { version: { version: number; status: string } })[]>;
  }

  async updateAlias(id: string, updates: { versionId?: string; isDefault?: boolean }) {
    if (updates.isDefault) {
      const alias = await this.db.agentAlias.findFirst({ where: { id } }) as AgentAlias | null;
      if (alias) {
        await this.clearOtherDefaults(alias.agentId);
      }
    }

    return this.db.agentAlias.update({
      where: { id },
      data: {
        ...(updates.versionId !== undefined && { versionId: updates.versionId }),
        ...(updates.isDefault !== undefined && { isDefault: updates.isDefault }),
      },
    }) as Promise<AgentAlias>;
  }

  async deleteAlias(id: string) {
    const alias = await this.db.agentAlias.findFirst({ where: { id } }) as AgentAlias | null;
    if (!alias) throw new Error('Alias not found');

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
  }

  async resolveAlias(agentId: string, aliasName?: string) {
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
      throw new Error(aliasName ? `Alias '${aliasName}' not found` : 'No default alias configured');
    }

    const { version } = alias as { version: { id: string; config: unknown } };
    return {
      aliasId: (alias as AgentAlias).id,
      aliasName: (alias as AgentAlias).name,
      versionId: version.id,
      config: version.config as Record<string, unknown>,
    };
  }

  private async clearOtherDefaults(agentId: string) {
    const defaults = await this.db.agentAlias.findMany({
      where: { agentId, isDefault: true },
    }) as AgentAlias[];

    for (const d of defaults) {
      await this.db.agentAlias.update({
        where: { id: d.id },
        data: { isDefault: false },
      });
    }
  }
}
