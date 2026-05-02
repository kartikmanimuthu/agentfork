import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostgresAuditLogRepository } from './postgres';

function createMockDb() {
  return {
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
  };
}

describe('PostgresAuditLogRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: PostgresAuditLogRepository;

  beforeEach(() => {
    db = createMockDb();
    repo = new PostgresAuditLogRepository(db);
  });

  describe('findAll', () => {
    it('returns paginated results with defaults', async () => {
      db.auditLog.findMany.mockResolvedValue([{ id: '1' }]);
      db.auditLog.count.mockResolvedValue(1);
      const result = await repo.findAll();
      expect(result).toEqual({ items: [{ id: '1' }], total: 1, limit: 50, offset: 0 });
    });

    it('filters by eventType', async () => {
      db.auditLog.findMany.mockResolvedValue([]);
      db.auditLog.count.mockResolvedValue(0);
      await repo.findAll({ eventType: 'login' });
      expect(db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ eventType: 'login' }) }),
      );
    });

    it('filters by severity', async () => {
      db.auditLog.findMany.mockResolvedValue([]);
      db.auditLog.count.mockResolvedValue(0);
      await repo.findAll({ severity: 'high' });
      expect(db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ severity: 'high' }) }),
      );
    });

    it('filters by date range', async () => {
      const start = new Date('2026-01-01');
      const end = new Date('2026-12-31');
      db.auditLog.findMany.mockResolvedValue([]);
      db.auditLog.count.mockResolvedValue(0);
      await repo.findAll({ startDate: start, endDate: end });
      expect(db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: start, lte: end },
          }),
        }),
      );
    });

    it('respects custom pagination', async () => {
      db.auditLog.findMany.mockResolvedValue([]);
      db.auditLog.count.mockResolvedValue(0);
      const result = await repo.findAll({}, { limit: 10, offset: 5 });
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(5);
      expect(db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 5 }),
      );
    });
  });

  describe('create', () => {
    it('creates an audit log entry', async () => {
      const input = { eventType: 'login', action: 'read', severity: 'info' };
      const created = { id: '1', ...input };
      db.auditLog.create.mockResolvedValue(created);
      const result = await repo.create(input);
      expect(result).toEqual(created);
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: input });
    });
  });
});
