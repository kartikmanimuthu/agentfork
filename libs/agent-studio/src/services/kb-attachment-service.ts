import { createLogger } from '@chatbot/shared';

const logger = createLogger('agent-studio:kb-attachment-service');

export interface AgentKnowledgeBasePrismaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
  findMany(args: { where: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<unknown[]>;
}

export interface KnowledgeBasePrismaDelegate {
  findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
}

export interface KbAttachmentDb {
  agentKnowledgeBase: AgentKnowledgeBasePrismaDelegate;
  knowledgeBase: KnowledgeBasePrismaDelegate;
}

export class KnowledgeBaseAttachmentService {
  constructor(
    private readonly tenantId: string,
    private readonly db: KbAttachmentDb
  ) {}

  async attach(agentId: string, knowledgeBaseId: string) {
    try {
      logger.info({ tenantId: this.tenantId, agentId, knowledgeBaseId }, 'Attaching knowledge base');
      const kb = await this.db.knowledgeBase.findFirst({
        where: { id: knowledgeBaseId, tenantId: this.tenantId },
      });
      if (!kb) {
        logger.warn({ tenantId: this.tenantId, agentId, knowledgeBaseId }, 'Knowledge base not found');
        throw new Error('Knowledge base not found');
      }

      const result = await this.db.agentKnowledgeBase.create({
        data: { agentId, knowledgeBaseId },
      });
      logger.info({ tenantId: this.tenantId, agentId, knowledgeBaseId }, 'Knowledge base attached');
      return result;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, agentId, knowledgeBaseId, error }, 'Failed to attach knowledge base');
      throw error;
    }
  }

  async detach(agentId: string, knowledgeBaseId: string) {
    try {
      logger.info({ tenantId: this.tenantId, agentId, knowledgeBaseId }, 'Detaching knowledge base');
      const result = await this.db.agentKnowledgeBase.deleteMany({
        where: { agentId, knowledgeBaseId },
      });
      logger.info({ tenantId: this.tenantId, agentId, knowledgeBaseId }, 'Knowledge base detached');
      return result;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, agentId, knowledgeBaseId, error }, 'Failed to detach knowledge base');
      throw error;
    }
  }

  async findAttached(agentId: string) {
    try {
      logger.debug({ tenantId: this.tenantId, agentId }, 'Listing attached knowledge bases');
      const result = await this.db.agentKnowledgeBase.findMany({
        where: { agentId },
        include: { knowledgeBase: true },
        orderBy: { createdAt: 'desc' },
      }) as Array<Record<string, unknown> & { knowledgeBase: Record<string, unknown> }>;
      logger.info({ tenantId: this.tenantId, agentId, count: result.length }, 'Attached knowledge bases listed');
      return result;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, agentId, error }, 'Failed to list attached knowledge bases');
      throw error;
    }
  }
}
