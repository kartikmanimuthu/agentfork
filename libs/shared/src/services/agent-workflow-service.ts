import { createLogger } from '../logging/logger';
import type { WorkflowDefinition } from '../workflow/workflow-types';

const logger = createLogger('agent-workflow-service');

export interface AgentWorkflowDb {
  agentWorkflow: {
    findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
  };
}

interface AgentWorkflowRow { id: string; agentId: string; tenantId: string; isActive: boolean; version: number; definition: unknown }

export class AgentWorkflowService {
  constructor(private readonly tenantId: string, private readonly db: AgentWorkflowDb) {}

  async getByAgent(agentId: string): Promise<AgentWorkflowRow | null> {
    return (await this.db.agentWorkflow.findFirst({ where: { agentId, tenantId: this.tenantId } })) as AgentWorkflowRow | null;
  }

  async upsert(agentId: string, definition: WorkflowDefinition): Promise<AgentWorkflowRow> {
    const existing = await this.getByAgent(agentId);
    if (existing) {
      logger.info({ tenantId: this.tenantId, agentId }, 'Updating agent workflow');
      return (await this.db.agentWorkflow.update({
        where: { id: existing.id },
        data: { definition: definition as unknown as Record<string, unknown> },
      })) as AgentWorkflowRow;
    }
    logger.info({ tenantId: this.tenantId, agentId }, 'Creating agent workflow');
    return (await this.db.agentWorkflow.create({
      data: { agentId, tenantId: this.tenantId, definition: definition as unknown as Record<string, unknown> },
    })) as AgentWorkflowRow;
  }

  async setActive(agentId: string, isActive: boolean): Promise<void> {
    const existing = await this.getByAgent(agentId);
    if (!existing) throw new Error('No workflow to activate for this agent');
    logger.info({ tenantId: this.tenantId, agentId, isActive }, 'Setting agent workflow active state');
    await this.db.agentWorkflow.update({ where: { id: existing.id }, data: { isActive } });
  }
}
