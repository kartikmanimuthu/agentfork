export { getPrismaClient, disconnectPrisma } from './db/prisma-client';
export { getTenantClient, TENANT_SCOPED_MODELS } from './db/tenant-middleware';
export {
  createConversationRepository,
  createMessageRepository,
  createAuditLogRepository,
} from './db/repositories/repository-factory';
export type { ConversationRepository, ConversationRecord, CreateConversationInput, UpdateConversationInput } from './db/repositories/conversation/interface';
export type { MessageRepository, MessageRecord, CreateMessageInput } from './db/repositories/message/interface';
export type { AuditLogRepository, AuditLogRecord, CreateAuditLogInput, AuditLogFilters } from './db/repositories/audit-log/interface';
export type { PaginationParams, PaginatedResult, ConversationStatus, MessageRole, AuditSeverity, InvitationStatus } from './types/domain';
