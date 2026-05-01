import type { PaginationParams, PaginatedResult } from '../../../types/domain';

export interface AuditLogRecord {
  id: string;
  tenantId: string;
  eventType: string;
  action: string;
  userId: string | null;
  resource: string | null;
  status: string;
  severity: string;
  metadata: any;
  createdAt: Date;
}

export interface CreateAuditLogInput {
  eventType: string;
  action: string;
  userId?: string;
  resource?: string;
  status?: string;
  severity?: string;
  metadata?: Record<string, unknown>;
  ttl?: Date;
}

export interface AuditLogFilters {
  eventType?: string;
  severity?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface AuditLogRepository {
  findAll(filters?: AuditLogFilters, params?: PaginationParams): Promise<PaginatedResult<AuditLogRecord>>;
  create(input: CreateAuditLogInput): Promise<AuditLogRecord>;
}
