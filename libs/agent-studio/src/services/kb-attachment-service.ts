export interface AgentKnowledgeBasePrismaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
  findMany(args: { where: Record<string, unknown>; include?: Record<string, unknown> }): Promise<unknown[]>;
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
    const kb = await this.db.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, tenantId: this.tenantId },
    });
    if (!kb) {
      throw new Error('Knowledge base not found');
    }

    return this.db.agentKnowledgeBase.create({
      data: { agentId, knowledgeBaseId },
    });
  }

  async detach(agentId: string, knowledgeBaseId: string) {
    return this.db.agentKnowledgeBase.deleteMany({
      where: { agentId, knowledgeBaseId },
    });
  }

  async findAttached(agentId: string) {
    return this.db.agentKnowledgeBase.findMany({
      where: { agentId },
      include: { knowledgeBase: true },
      orderBy: { createdAt: 'desc' },
    }) as Promise<Array<Record<string, unknown> & { knowledgeBase: Record<string, unknown> }>>;
  }
}
