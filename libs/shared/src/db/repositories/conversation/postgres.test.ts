import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostgresConversationRepository } from './postgres';

function createMockDb() {
  return {
    conversation: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

describe('PostgresConversationRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: PostgresConversationRepository;

  beforeEach(() => {
    db = createMockDb();
    repo = new PostgresConversationRepository(db);
  });

  describe('findById', () => {
    it('returns conversation when found', async () => {
      const conv = { id: '1', title: 'Test' };
      db.conversation.findUnique.mockResolvedValue(conv);
      const result = await repo.findById('1');
      expect(result).toEqual(conv);
      expect(db.conversation.findUnique).toHaveBeenCalledWith({ where: { id: '1' } });
    });

    it('returns null when not found', async () => {
      db.conversation.findUnique.mockResolvedValue(null);
      const result = await repo.findById('missing');
      expect(result).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('returns paginated results with defaults', async () => {
      db.conversation.findMany.mockResolvedValue([{ id: '1' }]);
      db.conversation.count.mockResolvedValue(1);
      const result = await repo.findByUserId('user-1');
      expect(result).toEqual({ items: [{ id: '1' }], total: 1, limit: 20, offset: 0 });
      expect(db.conversation.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        skip: 0,
      });
    });

    it('respects custom pagination params', async () => {
      db.conversation.findMany.mockResolvedValue([]);
      db.conversation.count.mockResolvedValue(0);
      await repo.findByUserId('user-1', { limit: 5, offset: 10 });
      expect(db.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5, skip: 10 }),
      );
    });
  });

  describe('create', () => {
    it('creates a conversation', async () => {
      const input = { userId: 'user-1', title: 'New Chat' };
      const created = { id: '1', ...input };
      db.conversation.create.mockResolvedValue(created);
      const result = await repo.create(input);
      expect(result).toEqual(created);
      expect(db.conversation.create).toHaveBeenCalledWith({ data: input });
    });
  });

  describe('update', () => {
    it('updates a conversation', async () => {
      const updated = { id: '1', title: 'Updated' };
      db.conversation.update.mockResolvedValue(updated);
      const result = await repo.update('1', { title: 'Updated' });
      expect(result).toEqual(updated);
      expect(db.conversation.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { title: 'Updated' },
      });
    });
  });

  describe('delete', () => {
    it('deletes a conversation', async () => {
      db.conversation.delete.mockResolvedValue({});
      await repo.delete('1');
      expect(db.conversation.delete).toHaveBeenCalledWith({ where: { id: '1' } });
    });
  });
});
