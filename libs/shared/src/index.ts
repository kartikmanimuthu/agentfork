// Env
export { env } from './env';

// Logging
export { createLogger } from './logging/logger';

// Database
export { getPrismaClient, disconnectPrisma } from './db/prisma-client';
export { getTenantClient, TENANT_SCOPED_MODELS } from './db/tenant-middleware';
export { createAuditLogRepository } from './db/repositories/repository-factory';
export type { AuditLogRepository, AuditLogRecord, CreateAuditLogInput, AuditLogFilters } from './db/repositories/audit-log/interface';
export type { PaginationParams, PaginatedResult, MessageRole, AuditSeverity, InvitationStatus } from './types/domain';

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
export { TenantConfigService } from './services/tenant-config-service';
export { InvitationService } from './services/invitation-service';
export { LlmProviderService } from './services/llm-provider-service';
export { getEmailService, setEmailService } from './services/email-service';
export { ApiKeyService } from './services/api-key-service';
export { QuotaService } from './services/quota-service';
export { ResponseCacheService } from './services/response-cache-service';
export { InferenceSessionService } from './services/inference-session-service';
export { WebhookService } from './services/webhook-service';
export { PausedExecutionService } from './services/paused-execution-service';
export {
  TelegramAccountBindingService,
  TelegramAccountBindingError,
} from './services/telegram-account-binding-service';
export type {
  TelegramAccountBindingDb,
  TelegramAccountBindingErrorCode,
  SyncTelegramAccountBindingInput,
} from './services/telegram-account-binding-service';
export type { PausedExecutionRow, CreatePausedExecutionInput } from './services/paused-execution-service';
export { S3Service } from './services/s3-service';
export { EncryptionService } from './services/encryption-service';
export { SdkWidgetService } from './services/sdk-widget-service';
export type { CreateSdkWidgetInput, SdkWidgetDb } from './services/sdk-widget-service';
export { FeedbackService } from './services/feedback-service';
export type { SubmitFeedbackInput } from './services/feedback-service';
export { CsatService } from './services/csat-service';
export type { SubmitCsatInput } from './services/csat-service';
// SES email service available for future use when @aws-sdk/client-ses is installed:
// export { SESEmailService } from './services/ses-email-service';

// Validation
export * from './validation';
