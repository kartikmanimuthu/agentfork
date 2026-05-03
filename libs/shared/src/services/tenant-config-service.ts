import { getTenantClient } from '../db/tenant-middleware';

export class TenantConfigService {
  private readonly db: any;
  private readonly tenantId: string;

  constructor(tenantId: string) {
    this.db = getTenantClient(tenantId);
    this.tenantId = tenantId;
  }

  async get<T = any>(key: string): Promise<T | null> {
    const config = await this.db.tenantConfig.findFirst({ where: { configKey: key } });
    return config?.data as T | null;
  }

  async set(key: string, value: any, updatedBy = 'system'): Promise<void> {
    await this.db.tenantConfig.upsert({
      where: { tenantId_configKey: { tenantId: this.tenantId, configKey: key } },
      create: { configKey: key, data: value, updatedBy },
      update: { data: value, updatedBy },
    });
  }
}
