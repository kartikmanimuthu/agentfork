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
export { S3Service } from './services/s3-service';
export { EncryptionService } from './services/encryption-service';
export { SdkWidgetService } from './services/sdk-widget-service';
export type { CreateSdkWidgetInput, SdkWidgetDb } from './services/sdk-widget-service';
export { AgentWorkflowService } from './services/agent-workflow-service';
export type { AgentWorkflowDb } from './services/agent-workflow-service';
export { FeedbackService } from './services/feedback-service';
export type { SubmitFeedbackInput } from './services/feedback-service';
export { CsatService } from './services/csat-service';
export type { SubmitCsatInput } from './services/csat-service';
export { ScoreConfigService } from './services/score-config-service';
export type { CreateScoreConfigInput, UpdateScoreConfigInput, ScoreDataType, ScoreCategory, ScoreConfigDb } from './services/score-config-service';
export { ScoreService } from './services/score-service';
export type { CreateManualScoreInput, IngestScoreInput, ScoreFilters, ScoreTargetType, ScoreValue, ScoreDb } from './services/score-service';
export { DatasetService } from './services/dataset-service';
export type { CreateDatasetInput, UpdateDatasetInput, DatasetDb } from './services/dataset-service';
export { DatasetItemService } from './services/dataset-item-service';
export type { CreateDatasetItemInput, UpdateDatasetItemInput, AddFromTraceInput, DatasetItemDb } from './services/dataset-item-service';
export { EvaluatorService } from './services/evaluator-service';
export type { CreateEvaluatorInput, UpdateEvaluatorInput, EvaluatorDb } from './services/evaluator-service';
export { AnnotationQueueService } from './services/annotation-queue-service';
export type { CreateAnnotationQueueInput, UpdateAnnotationQueueInput, AnnotationQueueDb } from './services/annotation-queue-service';
export { AnnotationQueueItemService } from './services/annotation-queue-item-service';
export type { ReviewQueueItemInput, AnnotationQueueItemDb } from './services/annotation-queue-item-service';
export { ExperimentService } from './services/experiment-service';
export type { CreateExperimentInput, UpdateExperimentInput, ExperimentDb } from './services/experiment-service';
export { exportDatasetItems } from './services/dataset-export';
export type { DatasetExportFormat, ExportableItem, ExportResult } from './services/dataset-export';
// SES email service available for future use when @aws-sdk/client-ses is installed:
// export { SESEmailService } from './services/ses-email-service';

// Validation
export * from './validation';

// Dashboards
export * from './dashboards';
export { DashboardQueryService, TOP_N } from './services/dashboard-query-service';
export type { DashboardQueryDb, QueryResultRow } from './services/dashboard-query-service';
export { DashboardService } from './services/dashboard-service';
export type { DashboardDb } from './services/dashboard-service';

// Workflow
export {
  workflowDefinitionSchema,
  workflowNodeSchema,
  workflowTransitionSchema,
  workflowCursorSchema,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkflowTransition,
  type WorkflowCursor,
  type MenuOption,
} from './workflow/workflow-types';

export {
  WorkflowEngine,
  type FileRefResolver,
  type WorkflowStreamEvent,
  type ResolveResult,
} from './workflow/workflow-engine';

export {
  graphToDefinition,
  definitionToGraph,
  validateGraph,
} from './workflow/workflow-graph';
export type { GraphNode, GraphEdge, GraphError } from './workflow/workflow-types';
