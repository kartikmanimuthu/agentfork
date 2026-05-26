import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  InferenceSessionService,
  DEFAULT_IDLE_MINUTES,
  type SessionDb,
  type InferenceSessionRecord,
} from './inference-session-service';

function makeMockDb() {
  const session = {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  };
  const message = {
    create: vi.fn(),
  };
  const db: SessionDb = {
    inferenceSession: session,
    inferenceSessionMessage: message,
  };
  return { db, session, message };
}

const baseSession: InferenceSessionRecord = {
  id: 'sess_1',
  apiKeyId: 'ak_1',
  tenantId: 't_1',
  agentId: 'a_1',
  agentVersionId: null,
  name: null,
  channel: 'API',
  channelMetadata: null,
  status: 'active',
  idleExpiresAt: new Date(Date.now() + 30 * 60_000),
  endedAt: null,
  endReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('InferenceSessionService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T20:00:00.000Z'));
  });

  describe('create', () => {
    it('creates an active session with default 30-min idle expiry and channel=API', async () => {
      const { db, session } = makeMockDb();
      session.create.mockResolvedValue({ ...baseSession });
      const svc = new InferenceSessionService(db);

      await svc.create({ apiKeyId: 'ak_1', tenantId: 't_1', agentId: 'a_1' });

      expect(session.create).toHaveBeenCalledTimes(1);
      const data = (session.create.mock.calls[0]![0]! as { data: Record<string, unknown> }).data;
      expect(data).toMatchObject({
        apiKeyId: 'ak_1',
        tenantId: 't_1',
        agentId: 'a_1',
        agentVersionId: null,
        name: null,
        channel: 'API',
        channelMetadata: null,
        status: 'active',
      });
      const idle = data.idleExpiresAt as Date;
      expect(idle.getTime() - Date.now()).toBe(DEFAULT_IDLE_MINUTES * 60 * 1000);
    });

    it('honours explicit channel, channelMetadata, agentVersionId and idleMinutes', async () => {
      const { db, session } = makeMockDb();
      session.create.mockResolvedValue({ ...baseSession });
      const svc = new InferenceSessionService(db);

      await svc.create({
        apiKeyId: 'ak_1',
        tenantId: 't_1',
        agentId: 'a_1',
        agentVersionId: 'av_1',
        channel: 'WHATSAPP',
        channelMetadata: { phone: '+1555' },
        idleMinutes: 60,
      });

      const data = (session.create.mock.calls[0]![0]! as { data: Record<string, unknown> }).data;
      expect(data.channel).toBe('WHATSAPP');
      expect(data.channelMetadata).toEqual({ phone: '+1555' });
      expect(data.agentVersionId).toBe('av_1');
      const idle = data.idleExpiresAt as Date;
      expect(idle.getTime() - Date.now()).toBe(60 * 60 * 1000);
    });
  });

  describe('findActiveById / findById', () => {
    it('only returns sessions with status=active and idleExpiresAt > now', async () => {
      const { db, session } = makeMockDb();
      session.findFirst.mockResolvedValue(baseSession);
      const svc = new InferenceSessionService(db);

      await svc.findActiveById('sess_1');

      const where = (session.findFirst.mock.calls[0]![0]! as { where: Record<string, unknown> }).where;
      expect(where).toMatchObject({ id: 'sess_1', status: 'active' });
      expect(where.idleExpiresAt).toEqual({ gt: new Date() });
    });

    it('findById is an alias for findActiveById', async () => {
      const { db, session } = makeMockDb();
      session.findFirst.mockResolvedValue(baseSession);
      const svc = new InferenceSessionService(db);

      await svc.findById('sess_1');
      expect(session.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('appendMessage', () => {
    it('writes a message row and bumps idleExpiresAt', async () => {
      const { db, session, message } = makeMockDb();
      session.findFirst.mockResolvedValue(baseSession);
      message.create.mockResolvedValue({
        id: 'msg_1',
        sessionId: 'sess_1',
        role: 'user',
        content: 'hi',
        tokenCount: null,
        createdAt: new Date(),
      });
      session.update.mockResolvedValue(baseSession);
      const svc = new InferenceSessionService(db);

      const result = await svc.appendMessage('sess_1', { role: 'user', content: 'hi' });

      expect(message.create).toHaveBeenCalledWith({
        data: { sessionId: 'sess_1', role: 'user', content: 'hi', tokenCount: null },
      });
      const updateData = (session.update.mock.calls[0]![0]! as { data: Record<string, unknown> }).data;
      const idle = updateData.idleExpiresAt as Date;
      expect(idle.getTime() - Date.now()).toBe(DEFAULT_IDLE_MINUTES * 60 * 1000);
      expect(result.role).toBe('user');
    });

    it('throws when the session is missing or already ended', async () => {
      const { db, session } = makeMockDb();
      session.findFirst.mockResolvedValue(null);
      const svc = new InferenceSessionService(db);

      await expect(svc.appendMessage('sess_x', { role: 'user', content: 'x' })).rejects.toThrow(
        /not found|ended|expired/i,
      );
    });
  });

  describe('endSession', () => {
    it('marks an active session ended with the given reason and returns the row', async () => {
      const { db, session } = makeMockDb();
      session.updateMany.mockResolvedValue({ count: 1 });
      session.findFirst.mockResolvedValue({ ...baseSession, status: 'ended', endReason: 'closed' });
      const svc = new InferenceSessionService(db);

      const result = await svc.endSession('sess_1', 'closed');

      expect(session.updateMany).toHaveBeenCalledWith({
        where: { id: 'sess_1', status: 'active' },
        data: expect.objectContaining({ status: 'ended', endReason: 'closed' }),
      });
      expect(result?.status).toBe('ended');
    });

    it('is a no-op success when the session is already ended', async () => {
      const { db, session } = makeMockDb();
      session.updateMany.mockResolvedValue({ count: 0 });
      session.findFirst.mockResolvedValue({ ...baseSession, status: 'ended', endReason: 'closed' });
      const svc = new InferenceSessionService(db);

      const result = await svc.endSession('sess_1', 'closed');
      expect(result?.status).toBe('ended');
    });
  });

  describe('findStaleSessions', () => {
    it('queries active rows whose idleExpiresAt is before now (defaults), ordered ASC', async () => {
      const { db, session } = makeMockDb();
      session.findMany.mockResolvedValue([baseSession]);
      const svc = new InferenceSessionService(db);

      await svc.findStaleSessions();

      const args = session.findMany.mock.calls[0]![0]! as {
        where: Record<string, unknown>;
        orderBy: Record<string, unknown>;
        take: number;
      };
      expect(args.where).toMatchObject({ status: 'active' });
      expect(args.where.idleExpiresAt).toEqual({ lt: new Date() });
      expect(args.orderBy).toEqual({ idleExpiresAt: 'asc' });
      expect(args.take).toBe(100);
    });

    it('honours custom idleBefore and limit', async () => {
      const { db, session } = makeMockDb();
      session.findMany.mockResolvedValue([]);
      const svc = new InferenceSessionService(db);

      const cutoff = new Date('2026-05-19T00:00:00.000Z');
      await svc.findStaleSessions({ idleBefore: cutoff, limit: 25 });

      const args = session.findMany.mock.calls[0]![0]! as {
        where: Record<string, unknown>;
        take: number;
      };
      expect(args.where.idleExpiresAt).toEqual({ lt: cutoff });
      expect(args.take).toBe(25);
    });
  });

  describe('findByApiKeyId', () => {
    it('returns active, non-idle-expired sessions for an api key, newest first', async () => {
      const { db, session } = makeMockDb();
      session.findMany.mockResolvedValue([]);
      const svc = new InferenceSessionService(db);

      await svc.findByApiKeyId('ak_1');

      const args = session.findMany.mock.calls[0]![0]! as {
        where: Record<string, unknown>;
        orderBy: Record<string, unknown>;
      };
      expect(args.where).toMatchObject({ apiKeyId: 'ak_1', status: 'active' });
      expect(args.where.idleExpiresAt).toEqual({ gt: new Date() });
      expect(args.orderBy).toEqual({ updatedAt: 'desc' });
    });
  });
});
