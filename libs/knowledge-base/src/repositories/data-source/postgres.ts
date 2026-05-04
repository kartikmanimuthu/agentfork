import type { PaginationParams, PaginatedResult } from '@chatbot/shared';
import type {
  DataSourceRepository,
  DataSourceRecord,
  CreateDataSourceRecord,
  UpdateDataSourceRecord,
} from './interface';

export class PostgresDataSourceRepository implements DataSourceRepository {
  constructor(private readonly db: any) {}

  async findById(id: string): Promise<DataSourceRecord | null> {
    return this.db.dataSource.findUnique({ where: { id } });
  }

  async findByKnowledgeBaseId(
    knowledgeBaseId: string,
    params: PaginationParams = {}
  ): Promise<PaginatedResult<DataSourceRecord>> {
    const { limit = 20, offset = 0 } = params;
    const where = { knowledgeBaseId };
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
  }

  async create(input: CreateDataSourceRecord): Promise<DataSourceRecord> {
    return this.db.dataSource.create({ data: input });
  }

  async update(id: string, input: UpdateDataSourceRecord): Promise<DataSourceRecord> {
    return this.db.dataSource.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.db.dataSource.delete({ where: { id } });
  }
}
