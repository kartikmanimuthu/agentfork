import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatasetItemService } from './dataset-item-service';

const mockDb = {
  dataset: { findFirst: vi.fn() },
  datasetItem: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
  inferenceSessionMessage: { findFirst: vi.fn() },
  inferenceSession: { findFirst: vi.fn() },
  apiKeyExecution: { findFirst: vi.fn() },
};

describe('DatasetItemService', () => {
  let service: DatasetItemService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new DatasetItemService(mockDb as any);
    mockDb.dataset.findFirst.mockResolvedValue({ id: 'd1', tenantId: 't1' });
  });

  it('creates an item after verifying dataset ownership', async () => {
    mockDb.datasetItem.create.mockResolvedValue({ id: 'i1' });
    await service.create('t1', 'd1', { input: { q: 'hi' }, expectedOutput: { a: 'hello' }, createdBy: 'u1' });
    expect(mockDb.datasetItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ datasetId: 'd1', createdBy: 'u1' }),
    });
  });

  it('throws when dataset belongs to another tenant', async () => {
    mockDb.dataset.findFirst.mockResolvedValue(null);
    await expect(service.create('t1', 'dX', { input: {}, createdBy: 'u1' })).rejects.toThrow(/dataset not found/i);
  });

  it('addFromTrace copies a message into input/expectedOutput with provenance', async () => {
    mockDb.inferenceSessionMessage.findFirst.mockResolvedValue({ id: 'm1', role: 'assistant', content: 'The answer', session: { tenantId: 't1' } });
    mockDb.datasetItem.create.mockResolvedValue({ id: 'i2' });
    await service.addFromTrace({ tenantId: 't1', datasetId: 'd1', targetType: 'MESSAGE', targetId: 'm1', createdBy: 'u1' });
    expect(mockDb.datasetItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ datasetId: 'd1', sourceMessageId: 'm1', createdBy: 'u1' }),
    });
  });

  it('bulkCreate inserts many rows', async () => {
    mockDb.datasetItem.createMany.mockResolvedValue({ count: 3 });
    const rows = [{ input: { a: 1 } }, { input: { a: 2 } }, { input: { a: 3 } }];
    const res = await service.bulkCreate('t1', 'd1', rows as never, 'u1');
    expect(res).toEqual({ count: 3 });
    expect(mockDb.datasetItem.createMany).toHaveBeenCalled();
  });

  it('addFromTrace for EXECUTION stores messages as input and text as expectedOutput', async () => {
    mockDb.apiKeyExecution.findFirst.mockResolvedValue({
      id: 'ex1',
      tenantId: 't1',
      input: { messages: [{ role: 'user', content: 'Hi' }], systemPrompt: 'You are helpful.' },
      output: { text: 'Hello!' },
    });
    mockDb.datasetItem.create.mockResolvedValue({ id: 'i3' });

    await service.addFromTrace({ tenantId: 't1', datasetId: 'd1', targetType: 'EXECUTION', targetId: 'ex1', createdBy: 'u1' });

    expect(mockDb.datasetItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceExecutionId: 'ex1',
        createdBy: 'u1',
      }),
    });
    const callData = mockDb.datasetItem.create.mock.calls[0][0].data;
    expect(callData.input).toMatchObject({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(callData.expectedOutput).toMatchObject({ content: 'Hello!' });
  });
});
