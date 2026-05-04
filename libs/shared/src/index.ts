// Env
export { env } from './env';

// Logging
export { createLogger } from './logging/logger';

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
export { getAuthSession, getSessionTenantId, getSessionUserId, assertSuperAdmin } from './auth/auth-session';
export { createAuthOptions } from './auth/auth-options';
export { getCognitoClient, COGNITO_USER_POOL_ID } from './auth/cognito-client';
import './auth/auth-types';

// RBAC
export { authorize, isAdmin, can, cannot } from './rbac/authorize';
export { hasPermission, hasCustomPermission, canAssignRole, getAutoLevel, ROLE_PERMISSIONS, ROLE_LEVELS } from './rbac/permissions';
export { SUBJECT_TO_MODULE, ACTION_MAP } from './rbac/types';
export type { Module, Action, PredefinedRole, RoleLevel, PermissionSet } from './rbac/types';
export {
  createCustomRole,
  getCustomRoles,
  getCustomRole,
  updateCustomRole,
  deleteCustomRole,
  getCustomRolePermissions,
} from './rbac/custom-role-service';
export type { CustomRoleInput, CustomRoleOutput } from './rbac/custom-role-service';

// Services
export { AuditService } from './services/audit-service';
export { ConversationService } from './services/conversation-service';
export { MessageService } from './services/message-service';
export { TenantConfigService } from './services/tenant-config-service';
export { InvitationService } from './services/invitation-service';
export { getEmailService, setEmailService } from './services/email-service';
// SES email service available for future use when @aws-sdk/client-ses is installed:
// export { SESEmailService } from './services/ses-email-service';

// Validation
export * from './validation';
