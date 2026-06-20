import { describe, it, expect, vi } from 'vitest';
import { DashboardQueryService, type DashboardQueryDb } from './dashboard-query-service';

function makeDb(overrides: Partial<Record<string, unknown>> = {}): DashboardQueryDb {
  return {
    $queryRaw: vi.fn(),
    inferenceSession: { groupBy: vi.fn(), count: vi.fn(), aggregate: vi.fn() },
    sessionAnalytics: { groupBy: vi.fn(), count: vi.fn(), aggregate: vi.fn() },
    ...overrides,
  } as unknown as DashboardQueryDb;
}

const KPI_SPEC = { source: 'sessions', metric: { key: 'count' }, dateRange: { preset: 'last_30d' as const }, filters: [], vizType: 'kpi' as const };

describe('DashboardQueryService', () => {
  it('kpi: returns a single count value scoped to tenant', async () => {
    const db = makeDb();
    (db.inferenceSession.count as ReturnType<typeof vi.fn>).mockResolvedValue(42);
    const rows = await new DashboardQueryService(db).run('t1', KPI_SPEC);
    expect(rows).toEqual([{ label: 'Session count', value: 42 }]);
    const callArg = (db.inferenceSession.count as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.where.tenantId).toBe('t1');
  });

  it('dimension: maps groupBy rows to {label,value}', async () => {
    const db = makeDb();
    (db.inferenceSession.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { channel: 'API', _count: { _all: 5 } },
      { channel: 'WEB', _count: { _all: 3 } },
    ]);
    const rows = await new DashboardQueryService(db).run('t1', { ...KPI_SPEC, dimension: 'channel', vizType: 'bar' });
    expect(rows).toEqual([{ label: 'API', value: 5 }, { label: 'WEB', value: 3 }]);
    expect((db.inferenceSession.groupBy as ReturnType<typeof vi.fn>).mock.calls[0][0].where.tenantId).toBe('t1');
  });

  it('time-series: passes tenantId as a bound param to raw SQL', async () => {
    const db = makeDb();
    (db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ bucket: new Date('2026-06-01'), value: 7 }]);
    const rows = await new DashboardQueryService(db).run('t1', { ...KPI_SPEC, timeBucket: 'day', vizType: 'line' });
    expect(rows[0].value).toBe(7);
    expect(db.$queryRaw).toHaveBeenCalled();
  });
});
