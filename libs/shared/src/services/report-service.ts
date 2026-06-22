import { createLogger } from '../logging/logger';
import type { z } from 'zod';
import type { createReportSchema, updateReportSchema } from '../validation/schemas/reports';

const logger = createLogger('service:report');

type CreateReportInput = z.infer<typeof createReportSchema>;
type UpdateReportInput = z.infer<typeof updateReportSchema>;

export interface ReportDb {
  report: {
    findMany: Function;
    findFirst: Function;
    create: Function;
    update: Function;
    delete: Function;
  };
}

export class ReportService {
  constructor(private readonly db: ReportDb) {}

  async listByTenant(tenantId: string) {
    try {
      return await this.db.report.findMany({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          description: true,
          vizType: true,
          updatedAt: true,
          createdById: true,
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Failed to list reports');
      throw error;
    }
  }

  async getById(tenantId: string, id: string) {
    try {
      return await this.db.report.findFirst({ where: { id, tenantId } });
    } catch (error) {
      logger.error({ err: error, tenantId, reportId: id }, 'Failed to load report');
      throw error;
    }
  }

  async create(tenantId: string, userId: string, input: CreateReportInput) {
    try {
      return await this.db.report.create({
        data: { ...input, tenantId, createdById: userId },
      });
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Failed to create report');
      throw error;
    }
  }

  async update(tenantId: string, id: string, input: UpdateReportInput) {
    try {
      await this.assertOwned(tenantId, id);
      return await this.db.report.update({ where: { id }, data: input });
    } catch (error) {
      logger.error({ err: error, tenantId, reportId: id }, 'Failed to update report');
      throw error;
    }
  }

  async remove(tenantId: string, id: string) {
    try {
      await this.assertOwned(tenantId, id);
      return await this.db.report.delete({ where: { id } });
    } catch (error) {
      logger.error({ err: error, tenantId, reportId: id }, 'Failed to delete report');
      throw error;
    }
  }

  private async assertOwned(tenantId: string, id: string) {
    const found = await this.db.report.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!found) throw new Error('Report not found');
  }
}
