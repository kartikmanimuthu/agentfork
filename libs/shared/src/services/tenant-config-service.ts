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

  /**
   * Removes a config row. Uses deleteMany so it stays idempotent (no throw when
   * the key was never set) and so the tenant-scoped client can inject tenantId
   * into the filter.
   */
  async delete(key: string): Promise<void> {
    await this.db.tenantConfig.deleteMany({ where: { configKey: key } });
  }

  /**
   * Lists every row whose key starts with `prefix` — the primitive multi-row
   * config concepts (e.g. one row per connected external account) are built
   * on, since `get`/`set`/`delete` only ever address a single exact key.
   */
  async listByPrefix<T = any>(
    prefix: string,
  ): Promise<Array<{ configKey: string; data: T; updatedAt: Date; updatedBy: string }>> {
    const rows = await this.db.tenantConfig.findMany({
      where: { configKey: { startsWith: prefix } },
      orderBy: { configKey: 'asc' },
    });
    return rows.map((r: any) => ({
      configKey: r.configKey as string,
      data: r.data as T,
      updatedAt: r.updatedAt as Date,
      updatedBy: r.updatedBy as string,
    }));
  }
}
