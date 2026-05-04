import type { PaginationParams, PaginatedResult } from '@chatbot/shared';
import type {
  DocumentRepository,
  DocumentRecord,
  CreateDocumentRecord,
  UpdateDocumentRecord,
} from './interface';

export class PostgresDocumentRepository implements DocumentRepository {
  constructor(private readonly db: any) {}

  async findById(id: string): Promise<DocumentRecord | null> {
    return this.db.document.findUnique({ where: { id } });
  }

  async findByDataSourceId(
    dataSourceId: string,
    params: PaginationParams & { status?: string } = {}
  ): Promise<PaginatedResult<DocumentRecord>> {
    const { limit = 20, offset = 0, status } = params;
    const where = status ? { dataSourceId, status } : { dataSourceId };
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
  }

  async findBySourceKey(dataSourceId: string, sourceKey: string): Promise<DocumentRecord | null> {
    return this.db.document.findFirst({ where: { dataSourceId, sourceKey } });
  }

  async create(input: CreateDocumentRecord): Promise<DocumentRecord> {
    return this.db.document.create({ data: input });
  }

  async update(id: string, input: UpdateDocumentRecord): Promise<DocumentRecord> {
    return this.db.document.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.db.document.delete({ where: { id } });
  }

  async deleteByDataSourceId(dataSourceId: string): Promise<number> {
    const result = await this.db.document.deleteMany({ where: { dataSourceId } });
    return result.count;
  }
}
