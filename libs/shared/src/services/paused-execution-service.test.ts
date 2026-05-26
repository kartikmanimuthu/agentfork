import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PausedExecutionService } from './paused-execution-service';

function makeDb() {
  return {
    pausedExecution: {
      create: vi.fn().mockResolvedValue({ id: 'pe-1', resumeToken: 'token-abc' }),
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    apiKeyExecution: {
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

describe('PausedExecutionService', () => {
  let db: ReturnType<typeof makeDb>;
  let svc: PausedExecutionService;

  beforeEach(() => {
    db = makeDb();
    svc = new PausedExecutionService(db as any);
  });

  describe('create', () => {
    it('creates a record with 24h expiry', async () => {
      const before = Date.now();
      await svc.create({
        tenantId: 'tenant-1',
        agentId: 'agent-1',
        executionId: 'exec-1',
        graphState: { channels: {}, messages: [], currentNodeId: null, metadata: {} as any },
        prompt: 'What is your name?',
        outputChannel: 'userName',
        nextNodeId: 'llm-2',
      });
      const callArg = db.pausedExecution.create.mock.calls[0][0].data;
      expect(callArg.tenantId).toBe('tenant-1');
      expect(callArg.prompt).toBe('What is your name?');
      expect(callArg.outputChannel).toBe('userName');
      expect(callArg.nextNodeId).toBe('llm-2');
      const expiresAt = new Date(callArg.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThan(before + 23 * 60 * 60 * 1000);
      expect(expiresAt).toBeLessThan(before + 25 * 60 * 60 * 1000);
    });

    it('returns the created record', async () => {
      const result = await svc.create({
        tenantId: 'tenant-1', agentId: 'agent-1', executionId: 'exec-1',
        graphState: { channels: {}, messages: [], currentNodeId: null, metadata: {} as any },
        prompt: 'q', outputChannel: 'out', nextNodeId: null,
      });
      expect(result).toEqual({ id: 'pe-1', resumeToken: 'token-abc' });
    });
  });

  describe('claimToken', () => {
    it('returns the row when token is valid and unclaimed', async () => {
      const row = {
        id: 'pe-1', resumeToken: 'tok', tenantId: 'tenant-1', agentId: 'agent-1',
        executionId: 'exec-1', graphState: {}, prompt: 'q', outputChannel: 'out',
        nextNodeId: 'n2', expiresAt: new Date(Date.now() + 60_000),
        resumedAt: null, createdAt: new Date(),
      };
      db.pausedExecution.findUnique = vi.fn().mockResolvedValue(row);
      db.pausedExecution.updateMany = vi.fn().mockResolvedValue({ count: 1 });

      const result = await svc.claimToken('tok');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('pe-1');
    });

    it('returns null when token not found', async () => {
      db.pausedExecution.updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const result = await svc.claimToken('bad-token');
      expect(result).toBeNull();
    });

    it('returns null when token already claimed (count 0 from CAS)', async () => {
      db.pausedExecution.updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const result = await svc.claimToken('already-used');
      expect(result).toBeNull();
    });

    it('returns null when token is expired (count 0 from CAS)', async () => {
      db.pausedExecution.updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const result = await svc.claimToken('expired-token');
      expect(result).toBeNull();
    });

    it('uses WHERE resumedAt IS NULL AND expiresAt > now in the CAS update', async () => {
      db.pausedExecution.updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const before = Date.now();
      await svc.claimToken('tok');
      const where = db.pausedExecution.updateMany.mock.calls[0][0].where;
      expect(where.resumeToken).toBe('tok');
      expect(where.resumedAt).toEqual(null);
      expect(new Date(where.expiresAt.gt).getTime()).toBeGreaterThanOrEqual(before - 100);
    });
  });

  describe('expireOld', () => {
    it('marks expired unclaimed records and returns count', async () => {
      db.pausedExecution.updateMany = vi.fn().mockResolvedValue({ count: 3 });
      const count = await svc.expireOld();
      const where = db.pausedExecution.updateMany.mock.calls[0][0].where;
      expect(where.resumedAt).toEqual(null);
      expect(where.expiresAt).toBeDefined();
      expect(count).toBe(3);
    });
  });
});
