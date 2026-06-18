import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScoreService } from './score-service';

const mockDb = {
  scoreConfig: { findFirst: vi.fn() },
  score: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn(), delete: vi.fn() },
  inferenceSessionMessage: { findFirst: vi.fn() },
  inferenceSession: { findFirst: vi.fn() },
  apiKeyExecution: { findFirst: vi.fn() },
};

const NUMERIC_CFG = { id: 'c1', tenantId: 't1', dataType: 'NUMERIC', minValue: 1, maxValue: 5, categories: null, isArchived: false };
const CAT_CFG = { id: 'c2', tenantId: 't1', dataType: 'CATEGORICAL', categories: [{ label: 'good', value: 1 }], isArchived: false };

describe('ScoreService', () => {
  let service: ScoreService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new ScoreService(mockDb as any);
  });

  it('creates a numeric manual score on a message (upsert: create path)', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(NUMERIC_CFG);
    mockDb.inferenceSessionMessage.findFirst.mockResolvedValue({ id: 'm1', session: { tenantId: 't1' } });
    mockDb.score.findFirst.mockResolvedValue(null);
    mockDb.score.create.mockResolvedValue({ id: 's1' });

    await service.createManual({ tenantId: 't1', configId: 'c1', targetType: 'MESSAGE', targetId: 'm1', value: 4, authorUserId: 'u1' });

    expect(mockDb.score.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 't1', configId: 'c1', targetType: 'MESSAGE', messageId: 'm1', sessionId: null, numericValue: 4, stringValue: null, source: 'ANNOTATION', authorUserId: 'u1' }),
    });
  });

  it('updates an existing manual score by same author (upsert: update path)', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(NUMERIC_CFG);
    mockDb.inferenceSessionMessage.findFirst.mockResolvedValue({ id: 'm1', session: { tenantId: 't1' } });
    mockDb.score.findFirst.mockResolvedValue({ id: 'existing' });
    mockDb.score.update.mockResolvedValue({ id: 'existing' });

    await service.createManual({ tenantId: 't1', configId: 'c1', targetType: 'MESSAGE', targetId: 'm1', value: 2, authorUserId: 'u1' });

    expect(mockDb.score.update).toHaveBeenCalledWith({ where: { id: 'existing' }, data: expect.objectContaining({ numericValue: 2 }) });
    expect(mockDb.score.create).not.toHaveBeenCalled();
  });

  it('rejects numeric value out of config range', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(NUMERIC_CFG);
    mockDb.inferenceSessionMessage.findFirst.mockResolvedValue({ id: 'm1', session: { tenantId: 't1' } });
    await expect(
      service.createManual({ tenantId: 't1', configId: 'c1', targetType: 'MESSAGE', targetId: 'm1', value: 99, authorUserId: 'u1' }),
    ).rejects.toThrow(/range/i);
  });

  it('resolves categorical label to mapped numericValue', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(CAT_CFG);
    mockDb.inferenceSession.findFirst.mockResolvedValue({ id: 'sess1', tenantId: 't1' });
    mockDb.score.findFirst.mockResolvedValue(null);
    mockDb.score.create.mockResolvedValue({ id: 's2' });

    await service.ingest({ tenantId: 't1', configId: 'c2', targetType: 'SESSION', targetId: 'sess1', value: 'good' });

    expect(mockDb.score.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetType: 'SESSION', sessionId: 'sess1', messageId: null, stringValue: 'good', numericValue: 1, source: 'API', authorUserId: null }),
    });
  });

  it('rejects a categorical value not in the config', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(CAT_CFG);
    mockDb.inferenceSession.findFirst.mockResolvedValue({ id: 'sess1', tenantId: 't1' });
    await expect(
      service.ingest({ tenantId: 't1', configId: 'c2', targetType: 'SESSION', targetId: 'sess1', value: 'bogus' }),
    ).rejects.toThrow(/categor/i);
  });

  it('rejects when target does not belong to tenant', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(NUMERIC_CFG);
    mockDb.inferenceSessionMessage.findFirst.mockResolvedValue(null);
    await expect(
      service.createManual({ tenantId: 't1', configId: 'c1', targetType: 'MESSAGE', targetId: 'mX', value: 3, authorUserId: 'u1' }),
    ).rejects.toThrow(/target/i);
  });

  it('creates a score targeting an EXECUTION', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(NUMERIC_CFG);
    mockDb.apiKeyExecution.findFirst.mockResolvedValue({ id: 'ex1', tenantId: 't1' });
    mockDb.score.findFirst.mockResolvedValue(null);
    mockDb.score.create.mockResolvedValue({ id: 's3' });

    await service.createManual({ tenantId: 't1', configId: 'c1', targetType: 'EXECUTION', targetId: 'ex1', value: 3, authorUserId: 'u1' });

    expect(mockDb.score.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetType: 'EXECUTION', executionId: 'ex1', messageId: null, sessionId: null, numericValue: 3, source: 'ANNOTATION' }),
    });
  });

  it('rejects EXECUTION score when execution not in tenant', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(NUMERIC_CFG);
    mockDb.apiKeyExecution.findFirst.mockResolvedValue(null);
    await expect(
      service.createManual({ tenantId: 't1', configId: 'c1', targetType: 'EXECUTION', targetId: 'exX', value: 3, authorUserId: 'u1' }),
    ).rejects.toThrow(/execution not found/i);
  });
});
