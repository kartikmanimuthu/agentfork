import { createAuditLogRepository } from '../db/repositories/repository-factory';
import { getTenantClient } from '../db/tenant-middleware';
import type { CreateAuditLogInput } from '../db/repositories/audit-log/interface';

export class AuditService {
  static async log(tenantId: string, input: CreateAuditLogInput): Promise<void> {
    try {
      const db = getTenantClient(tenantId);
      const repo = createAuditLogRepository(db);
      await repo.create(input);
    } catch (error) {
      console.error('AuditService.log failed:', error);
    }
  }
}
