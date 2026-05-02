import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostgresMessageRepository } from './postgres';

function createMockDb() {
  return {
    message: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    $executeRawUnsafe: vi.fn(),
  };
}

describe('PostgresMessageRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: PostgresMessageRepository;

  beforeEach(() => {
    db = createMockDb();
    repo = new PostgresMessageRepository(db);
  });

  describe('findByConversationId', () => {
    it('returns messages ordered by createdAt asc', async () => {
      const messages = [{ id: '1', role: 'user', content: 'hi' }];
      db.message.findMany.mockResolvedValue(messages);
      const result = await repo.findByConversationId('conv-1');
      expect(result).toEqual(messages);
      expect(db.message.findMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1' },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: { id: true, conversationId: true, role: true, content: true, tokenCount: true, createdAt: true },
      });
    });

    it('respects custom limit', async () => {
      db.message.findMany.mockResolvedValue([]);
      await repo.findByConversationId('conv-1', 10);
      expect(db.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });
  });

  describe('create', () => {
    it('creates a message', async () => {
      const input = { conversationId: 'conv-1', role: 'user', content: 'hello' };
      const created = { id: '1', ...input };
      db.message.create.mockResolvedValue(created);
      const result = await repo.create(input);
      expect(result).toEqual(created);
      expect(db.message.create).toHaveBeenCalledWith({ data: input });
    });
  });

  describe('updateEmbedding', () => {
    it('executes raw SQL to update vector', async () => {
      db.$executeRawUnsafe.mockResolvedValue(1);
      await repo.updateEmbedding('msg-1', [0.1, 0.2, 0.3]);
      expect(db.$executeRawUnsafe).toHaveBeenCalledWith(
        'UPDATE messages SET embedding = $1::vector WHERE id = $2',
        '[0.1,0.2,0.3]',
        'msg-1',
      );
    });
  });
});
