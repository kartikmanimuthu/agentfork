import { describe, it, expect, vi } from 'vitest';
import { DashboardService, type DashboardDb } from './dashboard-service';

function makeDb(): DashboardDb {
  return {
    dashboard: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    dashboardWidget: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findFirst: vi.fn() },
  } as unknown as DashboardDb;
}

describe('DashboardService', () => {
  it('listByTenant scopes to tenant', async () => {
    const db = makeDb();
    (db.dashboard.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await new DashboardService(db).listByTenant('t1');
    expect((db.dashboard.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where).toEqual({ tenantId: 't1' });
  });

  it('create persists tenantId and createdById', async () => {
    const db = makeDb();
    (db.dashboard.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'd1' });
    await new DashboardService(db).create('t1', 'u1', { name: 'Ops' });
    const data = (db.dashboard.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(data.tenantId).toBe('t1');
    expect(data.createdById).toBe('u1');
  });

  it('addWidget rejects when dashboard not owned by tenant', async () => {
    const db = makeDb();
    (db.dashboard.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      new DashboardService(db).addWidget('t1', 'd1', { title: 'X', querySpec: { source: 'sessions', metric: { key: 'count' }, dateRange: { preset: 'last_30d' }, filters: [], vizType: 'kpi' }, layout: { x: 0, y: 0, w: 4, h: 4 } }),
    ).rejects.toThrow();
  });
});
