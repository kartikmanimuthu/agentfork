import { describe, it, expect, vi } from 'vitest';
import { ReportService, type ReportDb } from './report-service';

function makeDb(overrides: Partial<ReportDb['report']> = {}): ReportDb {
  return {
    report: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      ...overrides,
    },
  } as unknown as ReportDb;
}

describe('ReportService', () => {
  it('listByTenant scopes the query to the tenant', async () => {
    const db = makeDb();
    (db.report.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await new ReportService(db).listByTenant('t1');
    expect((db.report.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where).toEqual({ tenantId: 't1' });
  });

  it('getById double-keys on id + tenantId', async () => {
    const db = makeDb();
    (db.report.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'r1' });
    await new ReportService(db).getById('t1', 'r1');
    expect((db.report.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0].where).toEqual({ id: 'r1', tenantId: 't1' });
  });

  it('create injects tenantId and createdById', async () => {
    const db = makeDb();
    (db.report.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'r1' });
    await new ReportService(db).create('t1', 'u1', {
      name: 'My report',
      sqlText: 'SELECT 1',
      vizType: 'table',
      vizConfig: { yKeys: [] },
    });
    const data = (db.report.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(data.tenantId).toBe('t1');
    expect(data.createdById).toBe('u1');
    expect(data.name).toBe('My report');
  });

  it('update asserts tenant ownership before updating', async () => {
    const db = makeDb();
    (db.report.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'r1' });
    (db.report.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'r1' });
    await new ReportService(db).update('t1', 'r1', { name: 'renamed' });
    expect((db.report.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0].where).toEqual({ id: 'r1', tenantId: 't1' });
    expect(db.report.update).toHaveBeenCalled();
  });

  it('update throws when the report is not owned by the tenant', async () => {
    const db = makeDb();
    (db.report.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(new ReportService(db).update('t1', 'r1', { name: 'x' })).rejects.toThrow('Report not found');
    expect(db.report.update).not.toHaveBeenCalled();
  });

  it('remove throws when the report is not owned by the tenant', async () => {
    const db = makeDb();
    (db.report.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(new ReportService(db).remove('t1', 'r1')).rejects.toThrow('Report not found');
    expect(db.report.delete).not.toHaveBeenCalled();
  });
});
