import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvaluatorRunnerService } from './evaluator-runner-service';
import { streamChat } from '@chatbot/ai';

vi.mock('@chatbot/ai', () => ({
  streamChat: vi.fn(),
}));

const mockedStreamChat = vi.mocked(streamChat);

const mockDb = {
  scoreConfig: {
    findFirst: vi.fn(),
  },
  score: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    delete: vi.fn(),
  },
  inferenceSessionMessage: {
    findFirst: vi.fn(),
  },
  inferenceSession: {
    findFirst: vi.fn(),
  },
  apiKeyExecution: {
    findFirst: vi.fn(),
  },
  evaluator: {
    findFirst: vi.fn(),
  },
};

const mockProvider = {
  streamChat: vi.fn(),
} as any;

describe('EvaluatorRunnerService', () => {
  let service: EvaluatorRunnerService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new EvaluatorRunnerService(mockDb as any);
  });

  it('runs a NUMERIC evaluator on a message and creates an API score with EVALUATOR source', async () => {
    mockDb.evaluator.findFirst.mockResolvedValue({
      id: 'e1',
      tenantId: 't1',
      name: 'Helpfulness',
      prompt: 'Rate helpfulness',
      scoreConfig: { id: 'c1', dataType: 'NUMERIC', categories: [] },
    });
    mockDb.inferenceSessionMessage.findFirst.mockResolvedValue({
      id: 'm1',
      role: 'assistant',
      content: 'hello',
      session: { tenantId: 't1' },
    });
    mockDb.scoreConfig.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1', dataType: 'NUMERIC', minValue: 1, maxValue: 5, categories: null, isArchived: false });
    mockDb.score.create.mockResolvedValue({ id: 's1' });

    mockedStreamChat.mockReturnValue({
      text: Promise.resolve('{"score": 4, "reason": "helpful"}'),
      usage: Promise.resolve({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }),
    } as any);

    await service.run({ tenantId: 't1', evaluatorId: 'e1', provider: mockProvider, targetType: 'MESSAGE', targetId: 'm1' });

    expect(mockedStreamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: mockProvider,
        messages: [{ role: 'user', content: expect.stringContaining('Rate helpfulness') }],
      }),
    );
    expect(mockDb.score.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 't1', configId: 'c1', source: 'EVALUATOR', numericValue: 4, stringValue: null }),
    });
  });

  it('parses a BOOLEAN evaluator response', async () => {
    mockDb.evaluator.findFirst.mockResolvedValue({
      id: 'e2',
      tenantId: 't1',
      name: 'Safe?',
      prompt: 'Is it safe?',
      scoreConfig: { id: 'c2', dataType: 'BOOLEAN', categories: [] },
    });
    mockDb.apiKeyExecution.findFirst.mockResolvedValue({ id: 'ex1', tenantId: 't1', input: {}, output: {} });
    mockDb.scoreConfig.findFirst.mockResolvedValue({ id: 'c2', tenantId: 't1', dataType: 'BOOLEAN', minValue: null, maxValue: null, categories: null, isArchived: false });
    mockDb.score.create.mockResolvedValue({ id: 's2' });

    mockedStreamChat.mockReturnValue({
      text: Promise.resolve('{"passed": true, "reason": "looks fine"}'),
      usage: Promise.resolve({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }),
    } as any);

    await service.run({ tenantId: 't1', evaluatorId: 'e2', provider: mockProvider, targetType: 'EXECUTION', targetId: 'ex1' });

    expect(mockDb.score.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ numericValue: 1, stringValue: 'true' }),
    });
  });

  it('throws when target message belongs to another tenant', async () => {
    mockDb.evaluator.findFirst.mockResolvedValue({
      id: 'e1',
      tenantId: 't1',
      name: 'Helpfulness',
      prompt: 'Rate helpfulness',
      scoreConfig: { id: 'c1', dataType: 'NUMERIC', categories: [] },
    });
    mockDb.inferenceSessionMessage.findFirst.mockResolvedValue({ id: 'm1', role: 'assistant', content: 'x', session: { tenantId: 't2' } });
    mockedStreamChat.mockReturnValue({ text: Promise.resolve('{"score": 1}'), usage: Promise.resolve({} as any) } as any);

    await expect(
      service.run({ tenantId: 't1', evaluatorId: 'e1', provider: mockProvider, targetType: 'MESSAGE', targetId: 'm1' }),
    ).rejects.toThrow(/not found/i);
  });

  it('throws when LLM response is not valid JSON', async () => {
    mockDb.evaluator.findFirst.mockResolvedValue({
      id: 'e1',
      tenantId: 't1',
      name: 'Helpfulness',
      prompt: 'Rate helpfulness',
      scoreConfig: { id: 'c1', dataType: 'NUMERIC', categories: [] },
    });
    mockDb.inferenceSessionMessage.findFirst.mockResolvedValue({ id: 'm1', role: 'assistant', content: 'x', session: { tenantId: 't1' } });
    mockedStreamChat.mockReturnValue({ text: Promise.resolve('not json'), usage: Promise.resolve({} as any) } as any);

    await expect(
      service.run({ tenantId: 't1', evaluatorId: 'e1', provider: mockProvider, targetType: 'MESSAGE', targetId: 'm1' }),
    ).rejects.toThrow(/valid JSON/i);
  });
});
