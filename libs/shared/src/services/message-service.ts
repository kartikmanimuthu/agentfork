import { createMessageRepository } from '../db/repositories/repository-factory';
import { getTenantClient } from '../db/tenant-middleware';
import type { CreateMessageInput } from '../db/repositories/message/interface';

export class MessageService {
  private readonly db: any;
  private readonly repo: ReturnType<typeof createMessageRepository>;

  constructor(tenantId: string) {
    this.db = getTenantClient(tenantId);
    this.repo = createMessageRepository(this.db);
  }

  findByConversationId(conversationId: string, limit?: number) { return this.repo.findByConversationId(conversationId, limit); }
  create(input: CreateMessageInput) { return this.repo.create(input); }
  updateEmbedding(id: string, embedding: number[]) { return this.repo.updateEmbedding(id, embedding); }
}
