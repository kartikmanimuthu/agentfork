import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRepo = {
  findById: vi.fn(),
  findByUserId: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../db/tenant-middleware', () => ({
  getTenantClient: vi.fn(() => ({})),
}));
vi.mock('../db/repositories/repository-factory', () => ({
  createConversationRepository: vi.fn(() => mockRepo),
}));

import { ConversationService } from './conversation-service';

describe('ConversationService', () => {
  let service: ConversationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ConversationService('tenant-1');
  });

  it('findById delegates to repository', async () => {
    mockRepo.findById.mockResolvedValue({ id: '1', title: 'Test' });
    const result = await service.findById('1');
    expect(result).toEqual({ id: '1', title: 'Test' });
    expect(mockRepo.findById).toHaveBeenCalledWith('1');
  });

  it('findByUserId delegates to repository', async () => {
    mockRepo.findByUserId.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
    const result = await service.findByUserId('user-1', { limit: 10 });
    expect(mockRepo.findByUserId).toHaveBeenCalledWith('user-1', { limit: 10 });
    expect(result.total).toBe(0);
  });

  it('create delegates to repository', async () => {
    const input = { userId: 'user-1', title: 'New' };
    mockRepo.create.mockResolvedValue({ id: '1', ...input });
    const result = await service.create(input);
    expect(result.id).toBe('1');
    expect(mockRepo.create).toHaveBeenCalledWith(input);
  });

  it('update delegates to repository', async () => {
    mockRepo.update.mockResolvedValue({ id: '1', title: 'Updated' });
    const result = await service.update('1', { title: 'Updated' });
    expect(result.title).toBe('Updated');
    expect(mockRepo.update).toHaveBeenCalledWith('1', { title: 'Updated' });
  });

  it('delete delegates to repository', async () => {
    mockRepo.delete.mockResolvedValue(undefined);
    await service.delete('1');
    expect(mockRepo.delete).toHaveBeenCalledWith('1');
  });
});
