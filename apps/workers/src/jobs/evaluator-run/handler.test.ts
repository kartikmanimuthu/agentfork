import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRunnerRun = vi.fn();
const mockGetDefaultConfig = vi.fn();
const mockPrisma = {
  inferenceSessionMessage: { findMany: vi.fn() },
};

vi.mock('@chatbot/shared/workers', () => ({
  getPrismaClient: vi.fn(() => mockPrisma),
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  EvaluatorRunnerService: vi.fn().mockImplementation(() => ({ run: mockRunnerRun })),
  LlmProviderService: vi.fn().mockImplementation(() => ({ getDefaultConfig: mockGetDefaultConfig })),
}));
vi.mock('@chatbot/ai', () => ({ createLLMProvider: vi.fn(() => ({})) }));

import { handleEvaluatorRun } from './handler';
import { evaluatorRunJobSchema } from './schema.js';

describe('evaluatorRunJobSchema', () => {
  it('rejects a payload missing tenantId', () => {
    expect(evaluatorRunJobSchema.safeParse({ evaluatorId: 'x' }).success).toBe(false);
  });
});

describe('handleEvaluatorRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultConfig.mockResolvedValue({});
  });

  it('rejects when the payload is missing tenantId', async () => {
    await expect(handleEvaluatorRun({ evaluatorId: 'e1' })).rejects.toThrow();
  });

  it('calls runner.run once per target message found', async () => {
    mockPrisma.inferenceSessionMessage.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    mockRunnerRun.mockResolvedValue(undefined);

    await handleEvaluatorRun({ evaluatorId: 'e1', tenantId: 't1' });

    expect(mockRunnerRun).toHaveBeenCalledTimes(2);
    expect(mockRunnerRun).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', evaluatorId: 'e1', targetType: 'MESSAGE', targetId: 'm1' }));
  });

  it('continues processing remaining targets when one run fails', async () => {
    mockPrisma.inferenceSessionMessage.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    mockRunnerRun.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);

    await expect(handleEvaluatorRun({ evaluatorId: 'e1', tenantId: 't1' })).resolves.toBeUndefined();
    expect(mockRunnerRun).toHaveBeenCalledTimes(2);
  });

  it('respects the limit from the parsed payload', async () => {
    mockPrisma.inferenceSessionMessage.findMany.mockResolvedValue([]);
    await handleEvaluatorRun({ evaluatorId: 'e1', tenantId: 't1', limit: 25 });
    expect(mockPrisma.inferenceSessionMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 25 }));
  });
});
