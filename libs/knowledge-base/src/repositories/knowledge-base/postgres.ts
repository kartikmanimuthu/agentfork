import type { PaginationParams, PaginatedResult } from '@chatbot/shared';
import type {
  KnowledgeBaseRepository,
  KnowledgeBaseRecord,
  CreateKnowledgeBaseRecord,
  UpdateKnowledgeBaseRecord,
} from './interface';

export class PostgresKnowledgeBaseRepository implements KnowledgeBaseRepository {
  constructor(private readonly db: any) {}

  async findById(id: string): Promise<KnowledgeBaseRecord | null> {
    return this.db.knowledgeBase.findUnique({ where: { id } });
  }

  async findByTenantId(
    tenantId: string,
    params: PaginationParams & { status?: string } = {}
  ): Promise<PaginatedResult<KnowledgeBaseRecord>> {
    const { limit = 20, offset = 0, status } = params;
    const where = status ? { tenantId, status } : { tenantId };
    const [items, total] = await Promise.all([
      this.db.knowledgeBase.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.db.knowledgeBase.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async create(input: CreateKnowledgeBaseRecord): Promise<KnowledgeBaseRecord> {
    return this.db.knowledgeBase.create({ data: input });
  }

  async update(id: string, input: UpdateKnowledgeBaseRecord): Promise<KnowledgeBaseRecord> {
    return this.db.knowledgeBase.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.db.knowledgeBase.delete({ where: { id } });
  }

  async incrementCounts(id: string, documentDelta: number, chunkDelta: number): Promise<void> {
    await this.db.knowledgeBase.update({
      where: { id },
      data: {
        documentCount: { increment: documentDelta },
        chunkCount: { increment: chunkDelta },
      },
    });
  }
}
