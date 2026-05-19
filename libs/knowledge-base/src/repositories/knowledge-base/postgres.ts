import { createLogger } from '@chatbot/shared/workers';
import type { PaginationParams, PaginatedResult } from '@chatbot/shared';
import type {
  KnowledgeBaseRepository,
  KnowledgeBaseRecord,
  CreateKnowledgeBaseRecord,
  UpdateKnowledgeBaseRecord,
} from './interface';

const repoLogger = createLogger('kb:repo:knowledge-base');

export class PostgresKnowledgeBaseRepository implements KnowledgeBaseRepository {
  constructor(private readonly db: any) {}

  async findById(id: string): Promise<KnowledgeBaseRecord | null> {
    try {
      return await this.db.knowledgeBase.findUnique({ where: { id } });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ id, errorMessage: error.message, errorStack: error.stack }, 'Failed to find knowledge base by id');
      throw error;
    }
  }

  async findByTenantId(
    tenantId: string,
    params: PaginationParams & { status?: string } = {}
  ): Promise<PaginatedResult<KnowledgeBaseRecord>> {
    const { limit = 20, offset = 0, status } = params;
    const where = status ? { tenantId, status } : { tenantId };
    try {
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
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ tenantId, params, errorMessage: error.message, errorStack: error.stack }, 'Failed to find knowledge bases by tenant');
      throw error;
    }
  }

  async create(input: CreateKnowledgeBaseRecord): Promise<KnowledgeBaseRecord> {
    try {
      return await this.db.knowledgeBase.create({ data: input });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ input, errorMessage: error.message, errorStack: error.stack }, 'Failed to create knowledge base');
      throw error;
    }
  }

  async update(id: string, input: UpdateKnowledgeBaseRecord): Promise<KnowledgeBaseRecord> {
    try {
      return await this.db.knowledgeBase.update({ where: { id }, data: input });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ id, input, errorMessage: error.message, errorStack: error.stack }, 'Failed to update knowledge base');
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.db.knowledgeBase.delete({ where: { id } });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ id, errorMessage: error.message, errorStack: error.stack }, 'Failed to delete knowledge base');
      throw error;
    }
  }

  async incrementCounts(id: string, documentDelta: number, chunkDelta: number): Promise<void> {
    try {
      await this.db.knowledgeBase.update({
        where: { id },
        data: {
          documentCount: { increment: documentDelta },
          chunkCount: { increment: chunkDelta },
        },
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ id, documentDelta, chunkDelta, errorMessage: error.message, errorStack: error.stack }, 'Failed to increment knowledge base counts');
      throw error;
    }
  }
}
