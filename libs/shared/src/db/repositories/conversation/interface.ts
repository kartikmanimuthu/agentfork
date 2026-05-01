import type { PaginationParams, PaginatedResult } from '../../../types/domain';

export interface ConversationRecord {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  model: string;
  status: string;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateConversationInput {
  userId: string;
  title?: string;
  model?: string;
}

export interface UpdateConversationInput {
  title?: string;
  status?: string;
  model?: string;
  messageCount?: number;
}

export interface ConversationRepository {
  findById(id: string): Promise<ConversationRecord | null>;
  findByUserId(userId: string, params?: PaginationParams): Promise<PaginatedResult<ConversationRecord>>;
  create(input: CreateConversationInput): Promise<ConversationRecord>;
  update(id: string, input: UpdateConversationInput): Promise<ConversationRecord>;
  delete(id: string): Promise<void>;
}
