import type { ConversationRepository, ConversationRecord, CreateConversationInput, UpdateConversationInput } from './interface';
import type { PaginationParams, PaginatedResult } from '../../../types/domain';

export class PostgresConversationRepository implements ConversationRepository {
  constructor(private readonly db: any) {}

  async findById(id: string): Promise<ConversationRecord | null> {
    return this.db.conversation.findUnique({ where: { id } });
  }

  async findByUserId(userId: string, params: PaginationParams = {}): Promise<PaginatedResult<ConversationRecord>> {
    const { limit = 20, offset = 0 } = params;
    const [items, total] = await Promise.all([
      this.db.conversation.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: limit, skip: offset }),
      this.db.conversation.count({ where: { userId } }),
    ]);
    return { items, total, limit, offset };
  }

  async create(input: CreateConversationInput): Promise<ConversationRecord> {
    return this.db.conversation.create({ data: input });
  }

  async update(id: string, input: UpdateConversationInput): Promise<ConversationRecord> {
    return this.db.conversation.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.db.conversation.delete({ where: { id } });
  }
}
