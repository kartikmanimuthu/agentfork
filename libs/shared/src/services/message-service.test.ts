import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRepo = {
  findByConversationId: vi.fn(),
  create: vi.fn(),
  updateEmbedding: vi.fn(),
};

vi.mock('../db/tenant-middleware', () => ({
  getTenantClient: vi.fn(() => ({})),
}));
vi.mock('../db/repositories/repository-factory', () => ({
  createMessageRepository: vi.fn(() => mockRepo),
}));

import { MessageService } from './message-service';

describe('MessageService', () => {
  let service: MessageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MessageService('tenant-1');
  });

  it('findByConversationId delegates to repository', async () => {
    mockRepo.findByConversationId.mockResolvedValue([{ id: '1', content: 'hi' }]);
    const result = await service.findByConversationId('conv-1', 10);
    expect(result).toHaveLength(1);
    expect(mockRepo.findByConversationId).toHaveBeenCalledWith('conv-1', 10);
  });

  it('create delegates to repository', async () => {
    const input = { conversationId: 'conv-1', role: 'user', content: 'hello' };
    mockRepo.create.mockResolvedValue({ id: '1', ...input });
    const result = await service.create(input);
    expect(result.id).toBe('1');
    expect(mockRepo.create).toHaveBeenCalledWith(input);
  });

  it('updateEmbedding delegates to repository', async () => {
    mockRepo.updateEmbedding.mockResolvedValue(undefined);
    await service.updateEmbedding('msg-1', [0.1, 0.2]);
    expect(mockRepo.updateEmbedding).toHaveBeenCalledWith('msg-1', [0.1, 0.2]);
  });
});
