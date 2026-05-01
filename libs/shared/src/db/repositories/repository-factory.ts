import { PostgresConversationRepository } from './conversation/postgres';
import { PostgresMessageRepository } from './message/postgres';
import { PostgresAuditLogRepository } from './audit-log/postgres';
import type { ConversationRepository } from './conversation/interface';
import type { MessageRepository } from './message/interface';
import type { AuditLogRepository } from './audit-log/interface';

export function createConversationRepository(db: any): ConversationRepository {
  return new PostgresConversationRepository(db);
}

export function createMessageRepository(db: any): MessageRepository {
  return new PostgresMessageRepository(db);
}

export function createAuditLogRepository(db: any): AuditLogRepository {
  return new PostgresAuditLogRepository(db);
}
