import { createConversationRepository } from '../db/repositories/repository-factory';
import { getTenantClient } from '../db/tenant-middleware';
import type { CreateConversationInput, UpdateConversationInput } from '../db/repositories/conversation/interface';
import type { PaginationParams } from '../types/domain';

export class ConversationService {
  private readonly db: any;
  private readonly repo: ReturnType<typeof createConversationRepository>;

  constructor(tenantId: string) {
    this.db = getTenantClient(tenantId);
    this.repo = createConversationRepository(this.db);
  }

  findById(id: string) { return this.repo.findById(id); }
  findByUserId(userId: string, params?: PaginationParams) { return this.repo.findByUserId(userId, params); }
  create(input: CreateConversationInput) { return this.repo.create(input); }
  update(id: string, input: UpdateConversationInput) { return this.repo.update(id, input); }
  delete(id: string) { return this.repo.delete(id); }
}
