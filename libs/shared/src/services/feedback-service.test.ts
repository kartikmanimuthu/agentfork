import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeedbackService } from './feedback-service';

const mockDb = {
  messageFeedback: {
    upsert: vi.fn(),
    findMany: vi.fn(),
  },
};

describe('FeedbackService', () => {
  let service: FeedbackService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FeedbackService(mockDb as any);
  });

  it('upserts feedback for a message', async () => {
    mockDb.messageFeedback.upsert.mockResolvedValue({ id: 'f1', rating: 'up' });

    const result = await service.submit({
      messageId: 'msg-1',
      sessionId: 'sess-1',
      rating: 'up',
      comment: 'Great answer',
    });

    expect(mockDb.messageFeedback.upsert).toHaveBeenCalledWith({
      where: { messageId_sessionId: { messageId: 'msg-1', sessionId: 'sess-1' } },
      create: { messageId: 'msg-1', sessionId: 'sess-1', rating: 'up', comment: 'Great answer' },
      update: { rating: 'up', comment: 'Great answer' },
    });
    expect(result).toEqual({ id: 'f1', rating: 'up' });
  });

  it('lists feedback for a session', async () => {
    mockDb.messageFeedback.findMany.mockResolvedValue([{ id: 'f1' }]);

    const result = await service.listBySession('sess-1');

    expect(mockDb.messageFeedback.findMany).toHaveBeenCalledWith({
      where: { sessionId: 'sess-1' },
    });
    expect(result).toHaveLength(1);
  });
});
