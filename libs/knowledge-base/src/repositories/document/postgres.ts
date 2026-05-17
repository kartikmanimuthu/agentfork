import { createLogger } from '@chatbot/shared/workers';
import type { PaginationParams, PaginatedResult } from '@chatbot/shared';
import type {
  DocumentRepository,
  DocumentRecord,
  CreateDocumentRecord,
  UpdateDocumentRecord,
} from './interface';

const repoLogger = createLogger('kb:repo:document');

export class PostgresDocumentRepository implements DocumentRepository {
  constructor(private readonly db: any) {}

  async findById(id: string): Promise<DocumentRecord | null> {
    try {
      return await this.db.document.findUnique({ where: { id } });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ id, errorMessage: error.message, errorStack: error.stack }, 'Failed to find document by id');
      throw error;
    }
  }

  async findByDataSourceId(
    dataSourceId: string,
    params: PaginationParams & { status?: string } = {}
  ): Promise<PaginatedResult<DocumentRecord>> {
    const { limit = 20, offset = 0, status } = params;
    const where = status ? { dataSourceId, status } : { dataSourceId };
    try {
      const [items, total] = await Promise.all([
        this.db.document.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        this.db.document.count({ where }),
      ]);
      return { items, total, limit, offset };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ dataSourceId, params, errorMessage: error.message, errorStack: error.stack }, 'Failed to find documents by data source');
      throw error;
    }
  }

  async findBySourceKey(dataSourceId: string, sourceKey: string): Promise<DocumentRecord | null> {
    try {
      return await this.db.document.findFirst({ where: { dataSourceId, sourceKey } });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ dataSourceId, sourceKey, errorMessage: error.message, errorStack: error.stack }, 'Failed to find document by source key');
      throw error;
    }
  }

  async create(input: CreateDocumentRecord): Promise<DocumentRecord> {
    try {
      return await this.db.document.create({ data: input });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ input, errorMessage: error.message, errorStack: error.stack }, 'Failed to create document');
      throw error;
    }
  }

  async update(id: string, input: UpdateDocumentRecord): Promise<DocumentRecord> {
    try {
      return await this.db.document.update({ where: { id }, data: input });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ id, input, errorMessage: error.message, errorStack: error.stack }, 'Failed to update document');
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.db.document.delete({ where: { id } });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ id, errorMessage: error.message, errorStack: error.stack }, 'Failed to delete document');
      throw error;
    }
  }

  async deleteByDataSourceId(dataSourceId: string): Promise<number> {
    try {
      const result = await this.db.document.deleteMany({ where: { dataSourceId } });
      return result.count;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ dataSourceId, errorMessage: error.message, errorStack: error.stack }, 'Failed to delete documents by data source');
      throw error;
    }
  }
}
