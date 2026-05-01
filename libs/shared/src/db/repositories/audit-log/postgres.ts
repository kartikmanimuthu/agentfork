import type { AuditLogRepository, AuditLogRecord, CreateAuditLogInput, AuditLogFilters } from './interface';
import type { PaginationParams, PaginatedResult } from '../../../types/domain';

export class PostgresAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: any) {}

  async findAll(filters: AuditLogFilters = {}, params: PaginationParams = {}): Promise<PaginatedResult<AuditLogRecord>> {
    const { limit = 50, offset = 0 } = params;
    const where: Record<string, unknown> = {};
    if (filters.eventType) where.eventType = filters.eventType;
    if (filters.severity) where.severity = filters.severity;
    if (filters.startDate || filters.endDate) {
      where.createdAt = {
        ...(filters.startDate ? { gte: filters.startDate } : {}),
        ...(filters.endDate ? { lte: filters.endDate } : {}),
      };
    }
    const [items, total] = await Promise.all([
      this.db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      this.db.auditLog.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async create(input: CreateAuditLogInput): Promise<AuditLogRecord> {
    return this.db.auditLog.create({ data: input });
  }
}
