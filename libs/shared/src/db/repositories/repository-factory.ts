import { PostgresAuditLogRepository } from './audit-log/postgres';
import type { AuditLogRepository } from './audit-log/interface';

export function createAuditLogRepository(db: any): AuditLogRepository {
  return new PostgresAuditLogRepository(db);
}
