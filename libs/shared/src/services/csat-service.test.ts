import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CsatService } from './csat-service';

const mockDb = {
  csatResponse: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
};

describe('CsatService', () => {
  let service: CsatService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CsatService(mockDb as any);
  });

  it('submits CSAT rating for a session', async () => {
    mockDb.csatResponse.upsert.mockResolvedValue({ id: 'c1', rating: 5 });

    const result = await service.submit({
      sessionId: 'sess-1',
      sdkWidgetId: 'w1',
      rating: 5,
      comment: 'Excellent',
    });

    expect(mockDb.csatResponse.upsert).toHaveBeenCalledWith({
      where: { sessionId: 'sess-1' },
      create: { sessionId: 'sess-1', sdkWidgetId: 'w1', rating: 5, comment: 'Excellent' },
      update: { rating: 5, comment: 'Excellent' },
    });
    expect(result).toEqual({ id: 'c1', rating: 5 });
  });

  it('finds CSAT by session', async () => {
    mockDb.csatResponse.findUnique.mockResolvedValue({ id: 'c1', rating: 4 });

    const result = await service.findBySession('sess-1');

    expect(result).toEqual({ id: 'c1', rating: 4 });
  });
});
