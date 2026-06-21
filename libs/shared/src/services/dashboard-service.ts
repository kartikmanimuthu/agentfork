import { createLogger } from '../logging/logger';
import type { z } from 'zod';
import type {
  createDashboardSchema,
  updateDashboardSchema,
  createWidgetSchema,
  updateWidgetSchema,
} from '../validation/schemas/dashboards';

const logger = createLogger('service:dashboard');

type CreateDashboardInput = z.infer<typeof createDashboardSchema>;
type UpdateDashboardInput = z.infer<typeof updateDashboardSchema>;
type CreateWidgetInput = z.infer<typeof createWidgetSchema>;
type UpdateWidgetInput = z.infer<typeof updateWidgetSchema>;

export interface DashboardDb {
  dashboard: {
    findMany: Function;
    findFirst: Function;
    create: Function;
    update: Function;
    delete: Function;
  };
  dashboardWidget: { create: Function; update: Function; delete: Function; findFirst: Function };
}

export class DashboardService {
  constructor(private readonly db: DashboardDb) {}

  async listByTenant(tenantId: string) {
    try {
      return await this.db.dashboard.findMany({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, name: true, description: true, isDefault: true, updatedAt: true },
      });
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Failed to list dashboards');
      throw error;
    }
  }

  async getById(tenantId: string, id: string) {
    try {
      return await this.db.dashboard.findFirst({
        where: { id, tenantId },
        include: { widgets: { orderBy: { order: 'asc' } } },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, dashboardId: id }, 'Failed to load dashboard');
      throw error;
    }
  }

  async create(tenantId: string, userId: string, input: CreateDashboardInput) {
    try {
      return await this.db.dashboard.create({ data: { ...input, tenantId, createdById: userId } });
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Failed to create dashboard');
      throw error;
    }
  }

  async update(tenantId: string, id: string, input: UpdateDashboardInput) {
    try {
      await this.assertOwned(tenantId, id);
      return await this.db.dashboard.update({ where: { id }, data: input });
    } catch (error) {
      logger.error({ err: error, tenantId, dashboardId: id }, 'Failed to update dashboard');
      throw error;
    }
  }

  async remove(tenantId: string, id: string) {
    try {
      await this.assertOwned(tenantId, id);
      return await this.db.dashboard.delete({ where: { id } });
    } catch (error) {
      logger.error({ err: error, tenantId, dashboardId: id }, 'Failed to delete dashboard');
      throw error;
    }
  }

  async addWidget(tenantId: string, dashboardId: string, input: CreateWidgetInput) {
    try {
      await this.assertOwned(tenantId, dashboardId);
      return await this.db.dashboardWidget.create({
        data: { dashboardId, tenantId, title: input.title, vizType: input.querySpec.vizType, querySpec: input.querySpec, layout: input.layout },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, dashboardId }, 'Failed to add widget');
      throw error;
    }
  }

  async updateWidget(tenantId: string, widgetId: string, input: UpdateWidgetInput) {
    try {
      const widget = await this.db.dashboardWidget.findFirst({ where: { id: widgetId, tenantId } });
      if (!widget) throw new Error('Widget not found');
      const data: Record<string, unknown> = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.layout !== undefined) data.layout = input.layout;
      if (input.querySpec !== undefined) {
        data.querySpec = input.querySpec;
        data.vizType = input.querySpec.vizType;
      }
      return await this.db.dashboardWidget.update({ where: { id: widgetId }, data });
    } catch (error) {
      logger.error({ err: error, tenantId, widgetId }, 'Failed to update widget');
      throw error;
    }
  }

  async removeWidget(tenantId: string, widgetId: string) {
    try {
      const widget = await this.db.dashboardWidget.findFirst({ where: { id: widgetId, tenantId } });
      if (!widget) throw new Error('Widget not found');
      return await this.db.dashboardWidget.delete({ where: { id: widgetId } });
    } catch (error) {
      logger.error({ err: error, tenantId, widgetId }, 'Failed to remove widget');
      throw error;
    }
  }

  async saveLayout(tenantId: string, dashboardId: string, layouts: { id: string; layout: unknown }[]) {
    try {
      await this.assertOwned(tenantId, dashboardId);
      await Promise.all(
        layouts.map((l) => this.db.dashboardWidget.update({ where: { id: l.id, tenantId, dashboardId }, data: { layout: l.layout } })),
      );
    } catch (error) {
      logger.error({ err: error, tenantId, dashboardId }, 'Failed to save layout');
      throw error;
    }
  }

  private async assertOwned(tenantId: string, dashboardId: string) {
    const found = await this.db.dashboard.findFirst({ where: { id: dashboardId, tenantId }, select: { id: true } });
    if (!found) throw new Error('Dashboard not found');
  }
}
