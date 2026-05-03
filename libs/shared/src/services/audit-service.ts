import { getPrismaClient } from '../db/prisma-client';
import { createLogger } from '../logging/logger';
import { env } from '../env';

const logger = createLogger('audit-service');

export interface AuditLogFilters {
  startDate?: string;
  endDate?: string;
  eventType?: string;
  status?: string;
  severity?: string;
  userType?: string;
  resourceType?: string;
  user?: string;
  correlationId?: string;
  executionId?: string;
  resourceId?: string;
  ipAddress?: string;
  source?: string;
  searchTerm?: string;
  limit?: number;
  nextPageToken?: string;
}

export interface AuditLogResponse {
  logs: AuditLog[];
  nextPageToken?: string;
}

export interface AuditLogStats {
  totalLogs: number;
  successCount: number;
  errorCount: number;
  warningCount: number;
  systemEvents: number;
  userEvents: number;
  criticalEvents: number;
  byEventType: Record<string, number>;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  byResourceType: Record<string, number>;
}

export interface AuditLog {
  id: string;
  type: 'audit_log';
  timestamp: string;
  tenantId?: string;
  eventType: string;
  action: string;
  user: string;
  userType: 'system' | 'user' | 'admin' | 'external';
  resource: string;
  resourceType?: string;
  resourceId?: string;
  status: 'success' | 'error' | 'warning' | 'info' | 'pending';
  severity: 'low' | 'medium' | 'high' | 'critical' | 'info';
  details: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  correlationId?: string;
  executionId?: string;
  region?: string;
  accountId?: string;
  duration?: number;
  errorCode?: string;
  source: 'platform' | 'system' | 'agent' | 'external';
  changeSet?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
  requestId?: string;
  apiRoute?: string;
  httpMethod?: string;
  dataClassification?: string;
  retentionDays?: number;
}

/** Retention days by event category per requirements */
const RETENTION_DAYS: Record<string, number> = {
  auth: 365,
  rbac: 365,
  tenant: 180,
  account: 90,
  schedule: 90,
  agent: 90,
  integration: 90,
  inventory: 30,
  kb: 30,
  chat: 30,
  trigger: 30,
};

/** Derive retention days from event type domain */
function getRetentionDays(eventType: string): number {
  const domain = eventType.split('.')[0];
  return RETENTION_DAYS[domain] ?? 90;
}

export class AuditService {
  /**
   * Create a new audit log entry.
   * Fire-and-forget: writes directly to PostgreSQL via Prisma.
   */
  static async createAuditLog(
    auditData: Omit<AuditLog, 'id' | 'type' | 'timestamp'>,
  ): Promise<void> {
    try {
      if (
        env.NODE_ENV === 'development' &&
        env.SKIP_AUDIT_LOGGING === 'true'
      ) {
        return;
      }

      if (
        !auditData ||
        typeof auditData !== 'object' ||
        Object.keys(auditData).length === 0
      ) {
        return;
      }

      const cleanedAuditData = this.validateAndCleanAuditData(auditData);
      const prisma = getPrismaClient();

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
          tenantId: (cleanedAuditData.tenantId as string) || 'global',
          eventType: cleanedAuditData.eventType as string,
          action: cleanedAuditData.action as string,
          userId: (cleanedAuditData.user as string) || null,
          resource: (cleanedAuditData.resource as string) || null,
          status: cleanedAuditData.status as string,
          severity: cleanedAuditData.severity as string,
          metadata: (cleanedAuditData.metadata as object) || {},
          ttl: cleanedAuditData.ttl as Date | undefined,
        },
      });
    } catch (error: unknown) {
      logger.error({ error }, 'AuditService - Error creating audit log');
    }
  }

  /**
   * Fetch audit logs with optional filters and pagination.
   */
  static async getAuditLogs(
    filters?: AuditLogFilters,
    tenantId?: string,
  ): Promise<AuditLogResponse> {
    try {
      logger.info({ filters }, 'AuditService - Fetching audit logs');
      if (!tenantId) throw new Error('getAuditLogs: tenantId is required');

      const prisma = getPrismaClient();
      const limit = filters?.limit ?? 50;
      const offset = filters?.nextPageToken
        ? parseInt(filters.nextPageToken, 10)
        : 0;

      const where: Record<string, unknown> = { tenantId };
      if (filters?.eventType) where.eventType = filters.eventType;
      if (filters?.status) where.status = filters.status;
      if (filters?.severity) where.severity = filters.severity;
      if (filters?.startDate || filters?.endDate) {
        where.createdAt = {
          ...(filters.startDate ? { gte: new Date(filters.startDate) } : {}),
          ...(filters.endDate ? { lte: new Date(filters.endDate) } : {}),
        };
      }

      const [items, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.auditLog.count({ where }),
      ]);

      const nextPageToken =
        offset + limit < total ? String(offset + limit) : undefined;

      const logs: AuditLog[] = items.map((item: any) => ({
        id: item.id,
        type: 'audit_log',
        timestamp: item.createdAt.toISOString(),
        eventType: item.eventType,
        action: item.action,
        user: item.userId || 'system',
        userType: 'system',
        resource: item.resource || '',
        resourceType: item.metadata?.resourceType || '',
        resourceId: item.metadata?.resourceId || '',
        status: item.status as AuditLog['status'],
        severity: item.severity as AuditLog['severity'],
        details: item.metadata?.details || '',
        metadata: item.metadata || {},
        source: item.metadata?.source || 'system',
      }));

      return { logs, nextPageToken };
    } catch (error: unknown) {
      logger.error({ error }, 'AuditService - Error fetching audit logs');
      return { logs: [], nextPageToken: undefined };
    }
  }

  /**
   * Get audit logs by correlation ID.
   */
  static async getAuditLogsByCorrelation(
    correlationId: string,
    tenantId?: string,
  ): Promise<AuditLog[]> {
    try {
      const result = await this.getAuditLogs(
        { correlationId, limit: 100 },
        tenantId,
      );
      return result.logs;
    } catch (error: unknown) {
      logger.error({ error }, 'AuditService - Error fetching correlated audit logs');
      return [];
    }
  }

  /**
   * Get audit log stats — derived from recent logs.
   */
  static async getAuditLogStats(
    filters?: AuditLogFilters,
    tenantId?: string,
  ): Promise<AuditLogStats> {
    try {
      const { logs } = await this.getAuditLogs(
        { ...filters, limit: 500, nextPageToken: undefined },
        tenantId,
      );

      return {
        totalLogs: logs.length,
        successCount: logs.filter((log) => log.status === 'success').length,
        errorCount: logs.filter((log) => log.status === 'error').length,
        warningCount: logs.filter((log) => log.status === 'warning').length,
        systemEvents: logs.filter((log) => log.userType === 'system').length,
        userEvents: logs.filter(
          (log) => log.userType === 'user' || log.userType === 'admin',
        ).length,
        criticalEvents: logs.filter((log) => log.severity === 'critical').length,
        byEventType: this.groupBy(logs, 'eventType'),
        byStatus: this.groupBy(logs, 'status'),
        bySeverity: this.groupBy(logs, 'severity'),
        byResourceType: this.groupBy(logs, 'resourceType'),
      };
    } catch (error: unknown) {
      logger.error({ error }, 'AuditService - Error fetching audit log stats');
      return {
        totalLogs: 0,
        successCount: 0,
        errorCount: 0,
        warningCount: 0,
        systemEvents: 0,
        userEvents: 0,
        criticalEvents: 0,
        byEventType: {},
        byStatus: {},
        bySeverity: {},
        byResourceType: {},
      };
    }
  }

  // Helper methods
  private static groupBy(
    array: AuditLog[],
    key: keyof AuditLog,
  ): Record<string, number> {
    return array.reduce((result, item) => {
      const value = (item[key] as string) || 'unknown';
      result[value] = (result[value] || 0) + 1;
      return result;
    }, {} as Record<string, number>);
  }

  private static validateAndCleanAuditData(
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!data || typeof data !== 'object') throw new Error('Invalid audit data');

    const retentionDays =
      (data.retentionDays as number) ?? getRetentionDays((data.eventType as string) || '');
    const ttl = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

    return {
      ...data,
      action: data.action || 'Unknown Action',
      status: data.status || 'info',
      user: data.user || 'system',
      timestamp: data.timestamp || new Date().toISOString(),
      retentionDays,
      ttl,
    };
  }

  /**
   * Log a user-initiated platform action.
   * Generates standardized domain.entity.action event type.
   */
  static async logUserAction(data: {
    action: string;
    resourceType: string;
    resourceId: string;
    resourceName: string;
    user: string;
    userType: 'user' | 'admin';
    status: 'success' | 'error' | 'warning';
    details: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
    tenantId?: string;
    eventType?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical' | 'info';
    changeSet?: {
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    };
    requestId?: string;
    apiRoute?: string;
    httpMethod?: string;
    dataClassification?: string;
  }): Promise<void> {
    try {
      const tenantId = data.tenantId || (data.metadata?.tenantId as string);
      const eventType =
        data.eventType ||
        `${data.resourceType}.${data.action.toLowerCase().replace(/\s+/g, '_')}`;
      await this.createAuditLog({
        eventType,
        ...data,
        ...(tenantId ? { tenantId } : {}),
        resource: data.resourceName || data.resourceId,
        severity:
          data.severity ??
          (data.status === 'error'
            ? 'high'
            : data.status === 'warning'
              ? 'medium'
              : 'info'),
        source: 'platform',
      });
    } catch (error) {
      logger.error({ error }, 'Failed to create user action audit log');
    }
  }

  /**
   * Log a resource-level action (schedule execution, sync, etc.).
   */
  static async logResourceAction(data: {
    action: string;
    resourceType: string;
    resourceId: string;
    resourceName: string;
    status: 'success' | 'error' | 'warning';
    details: string;
    user?: string;
    userType?: 'system' | 'user' | 'admin';
    metadata?: Record<string, unknown>;
    correlationId?: string;
    accountId?: string;
    region?: string;
    source?: 'platform' | 'system' | 'agent' | 'external';
    tenantId?: string;
    eventType?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical' | 'info';
    changeSet?: {
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    };
    requestId?: string;
    apiRoute?: string;
    httpMethod?: string;
    dataClassification?: string;
  }): Promise<void> {
    try {
      const tenantId = data.tenantId || (data.metadata?.tenantId as string);
      const eventType =
        data.eventType ||
        `${data.resourceType}.${data.action.toLowerCase().replace(/\s+/g, '_')}`;
      await this.createAuditLog({
        eventType,
        ...data,
        ...(tenantId ? { tenantId } : {}),
        resource: data.resourceName || data.resourceId,
        severity:
          data.severity ??
          (data.status === 'error'
            ? 'high'
            : data.status === 'warning'
              ? 'medium'
              : 'info'),
        user: data.user || 'system',
        userType: data.userType || 'system',
        source: data.source || 'system',
      });
    } catch (error) {
      logger.error({ error }, 'Failed to create resource action audit log');
    }
  }

  /**
   * Log a system event (background jobs, workers, cron tasks).
   * Sets userType='system', source='system'.
   */
  static async logSystemEvent(data: {
    eventType: string;
    action: string;
    status: 'success' | 'error' | 'warning';
    details: string;
    resourceType?: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
    correlationId?: string;
    executionId?: string;
    accountId?: string;
    region?: string;
    duration?: number;
    errorCode?: string;
    tenantId?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical' | 'info';
  }): Promise<void> {
    try {
      const tenantId = data.tenantId || (data.metadata?.tenantId as string);
      await this.createAuditLog({
        ...data,
        ...(tenantId ? { tenantId } : {}),
        resource: data.resourceId || '',
        severity:
          data.severity ??
          (data.status === 'error'
            ? 'high'
            : data.status === 'warning'
              ? 'medium'
              : 'info'),
        user: 'system',
        userType: 'system',
        source: 'system',
      });
    } catch (error) {
      logger.error({ error }, 'Failed to create system event audit log');
    }
  }

  /**
   * Log an agent event (AI agent tool executions).
   * Sets source='agent', requires correlationId (threadId).
   */
  static async logAgentEvent(data: {
    eventType: string;
    action: string;
    userId: string;
    status: 'success' | 'error' | 'warning';
    details: string;
    resourceType?: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
    correlationId: string;
    executionId?: string;
    accountId?: string;
    region?: string;
    tenantId?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical' | 'info';
  }): Promise<void> {
    try {
      const tenantId = data.tenantId || (data.metadata?.tenantId as string);
      await this.createAuditLog({
        ...data,
        ...(tenantId ? { tenantId } : {}),
        resource: data.resourceId || '',
        severity: data.severity ?? (data.status === 'error' ? 'high' : 'medium'),
        user: data.userId,
        userType: 'user',
        source: 'agent',
      });
    } catch (error) {
      logger.error({ error }, 'Failed to create agent event audit log');
    }
  }

  /**
   * Legacy compatibility shim. Delegates to createAuditLog via repository pattern.
   */
  static async log(tenantId: string, input: any): Promise<void> {
    try {
      const prisma = getPrismaClient();
      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
          tenantId,
          eventType: input.eventType || 'unknown',
          action: input.action || 'unknown',
          userId: input.userId || null,
          resource: input.resource || null,
          status: input.status || 'success',
          severity: input.severity || 'info',
          metadata: input.metadata || {},
          ttl: input.ttl || undefined,
        },
      });
    } catch (error) {
      logger.error({ error }, 'AuditService.log failed');
    }
  }
}
