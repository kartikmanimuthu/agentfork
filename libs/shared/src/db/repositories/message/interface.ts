export interface MessageRecord {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  tokenCount: number | null;
  createdAt: Date;
}

export interface CreateMessageInput {
  conversationId: string;
  role: string;
  content: string;
  tokenCount?: number;
}

export interface MessageRepository {
  findByConversationId(conversationId: string, limit?: number): Promise<MessageRecord[]>;
  create(input: CreateMessageInput): Promise<MessageRecord>;
  updateEmbedding(id: string, embedding: number[]): Promise<void>;
}
