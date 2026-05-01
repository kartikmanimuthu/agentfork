import type { MessageRepository, MessageRecord, CreateMessageInput } from './interface';

export class PostgresMessageRepository implements MessageRepository {
  constructor(private readonly db: any) {}

  async findByConversationId(conversationId: string, limit = 50): Promise<MessageRecord[]> {
    return this.db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, conversationId: true, role: true, content: true, tokenCount: true, createdAt: true },
    });
  }

  async create(input: CreateMessageInput): Promise<MessageRecord> {
    return this.db.message.create({ data: input });
  }

  async updateEmbedding(id: string, embedding: number[]): Promise<void> {
    const vectorStr = `[${embedding.join(',')}]`;
    await this.db.$executeRawUnsafe(`UPDATE messages SET embedding = $1::vector WHERE id = $2`, vectorStr, id);
  }
}
