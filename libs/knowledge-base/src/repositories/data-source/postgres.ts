import { createLogger } from '@chatbot/shared/workers';
import type { PaginationParams, PaginatedResult } from '@chatbot/shared';
import type {
  DataSourceRepository,
  DataSourceRecord,
  CreateDataSourceRecord,
  UpdateDataSourceRecord,
} from './interface';

const repoLogger = createLogger('kb:repo:data-source');

export class PostgresDataSourceRepository implements DataSourceRepository {
  constructor(private readonly db: any) {}

  async findById(id: string): Promise<DataSourceRecord | null> {
    try {
      return await this.db.dataSource.findUnique({ where: { id } });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ id, errorMessage: error.message, errorStack: error.stack }, 'Failed to find data source by id');
      throw error;
    }
  }

  async findByKnowledgeBaseId(
    knowledgeBaseId: string,
    params: PaginationParams = {}
  ): Promise<PaginatedResult<DataSourceRecord>> {
    const { limit = 20, offset = 0 } = params;
    const where = { knowledgeBaseId };
    try {
      const [items, total] = await Promise.all([
        this.db.dataSource.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        this.db.dataSource.count({ where }),
      ]);
      return { items, total, limit, offset };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ knowledgeBaseId, params, errorMessage: error.message, errorStack: error.stack }, 'Failed to find data sources by knowledge base');
      throw error;
    }
  }

  async create(input: CreateDataSourceRecord): Promise<DataSourceRecord> {
    try {
      return await this.db.dataSource.create({ data: input });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ input, errorMessage: error.message, errorStack: error.stack }, 'Failed to create data source');
      throw error;
    }
  }

  async update(id: string, input: UpdateDataSourceRecord): Promise<DataSourceRecord> {
    try {
      return await this.db.dataSource.update({ where: { id }, data: input });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ id, input, errorMessage: error.message, errorStack: error.stack }, 'Failed to update data source');
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.db.dataSource.delete({ where: { id } });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ id, errorMessage: error.message, errorStack: error.stack }, 'Failed to delete data source');
      throw error;
    }
  }
}
