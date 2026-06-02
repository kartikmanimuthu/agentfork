import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from './session-manager';

const mockPrisma = {
  whatsAppSession: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SessionManager(mockPrisma as any);
  });

  describe('findActiveSession', () => {
    it('returns active session for contact', async () => {
      const session = { id: 'sess_1', state: 'active', agentId: 'agent_1', windowExpiresAt: new Date(Date.now() + 86400000) };
      mockPrisma.whatsAppSession.findFirst.mockResolvedValueOnce(session);

      const result = await manager.findActiveSession('acc_1', '15559876543');
      expect(result).toEqual(session);
    });

    it('returns null when no active session', async () => {
      mockPrisma.whatsAppSession.findFirst.mockResolvedValueOnce(null);
      const result = await manager.findActiveSession('acc_1', '15559876543');
      expect(result).toBeNull();
    });

    it('expires session if window has passed', async () => {
      const expired = { id: 'sess_1', state: 'active', agentId: 'agent_1', windowExpiresAt: new Date(Date.now() - 1000) };
      mockPrisma.whatsAppSession.findFirst.mockResolvedValueOnce(expired);
      mockPrisma.whatsAppSession.update.mockResolvedValueOnce({ ...expired, state: 'expired' });

      const result = await manager.findActiveSession('acc_1', '15559876543');
      expect(result).toBeNull();
      expect(mockPrisma.whatsAppSession.update).toHaveBeenCalledWith({
        where: { id: 'sess_1' },
        data: { state: 'expired' },
      });
    });
  });

  describe('createSession', () => {
    it('creates a new session with 24h window', async () => {
      mockPrisma.whatsAppSession.create.mockImplementation(({ data }) => Promise.resolve({ id: 'sess_new', ...data }));

      const result = await manager.createSession({
        accountId: 'acc_1',
        contactPhone: '15559876543',
        contactName: 'John',
        agentId: 'agent_1',
      });

      expect(result.accountId).toBe('acc_1');
      expect(result.agentId).toBe('agent_1');
      expect(result.state).toBe('active');
    });
  });

  describe('refreshWindow', () => {
    it('updates lastMessageAt and windowExpiresAt', async () => {
      mockPrisma.whatsAppSession.update.mockResolvedValueOnce({ id: 'sess_1' });

      await manager.refreshWindow('sess_1');

      expect(mockPrisma.whatsAppSession.update).toHaveBeenCalledWith({
        where: { id: 'sess_1' },
        data: expect.objectContaining({
          lastMessageAt: expect.any(Date),
          windowExpiresAt: expect.any(Date),
        }),
      });
    });
  });
});
