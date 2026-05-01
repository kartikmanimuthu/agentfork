// Database
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

// Auth
export { getSessionTenantId, getSessionUserId, assertSuperAdmin } from './auth/auth-session';
export { createAuthOptions } from './auth/auth-options';
import './auth/types';

// RBAC
export { authorize } from './rbac/authorize';
export { hasPermission, hasCustomPermission, ROLE_PERMISSIONS, ROLE_LEVELS } from './rbac/permissions';
export type { Module, Action, PredefinedRole, PermissionSet } from './rbac/types';

// Services
export { AuditService } from './services/audit-service';
export { ConversationService } from './services/conversation-service';
export { MessageService } from './services/message-service';
export { TenantConfigService } from './services/tenant-config-service';
