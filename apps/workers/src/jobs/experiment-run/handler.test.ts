import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRunnerRun = vi.fn();
const mockGetDefaultConfig = vi.fn();

vi.mock('@chatbot/shared/workers', () => ({
  getPrismaClient: vi.fn(() => ({})),
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  ExperimentRunnerService: vi.fn().mockImplementation(() => ({ run: mockRunnerRun })),
  LlmProviderService: vi.fn().mockImplementation(() => ({ getDefaultConfig: mockGetDefaultConfig })),
}));
vi.mock('@chatbot/ai', () => ({ createLLMProvider: vi.fn(() => ({ id: 'provider-instance' })) }));

import { handleExperimentRun } from './handler';
import { experimentRunJobSchema } from './schema.js';
import * as aiModule from '@chatbot/ai';

describe('experimentRunJobSchema', () => {
  it('rejects a payload missing experimentId', () => {
    expect(experimentRunJobSchema.safeParse({ tenantId: 't1' }).success).toBe(false);
  });
  it('rejects a payload missing tenantId', () => {
    expect(experimentRunJobSchema.safeParse({ experimentId: 'e1' }).success).toBe(false);
  });
});

describe('handleExperimentRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultConfig.mockResolvedValue({ model: 'm1' });
  });

  it('rejects an invalid payload before doing any work', async () => {
    await expect(handleExperimentRun({ experimentId: 'e1' })).rejects.toThrow();
    expect(mockRunnerRun).not.toHaveBeenCalled();
  });

  it('resolves the provider then calls runner.run exactly once with userId "system"', async () => {
    mockRunnerRun.mockResolvedValue(undefined);
    await handleExperimentRun({ experimentId: 'e1', tenantId: 't1' });

    expect(mockGetDefaultConfig).toHaveBeenCalled();
    expect(vi.mocked(aiModule.createLLMProvider)).toHaveBeenCalledWith({ model: 'm1' });
    expect(mockRunnerRun).toHaveBeenCalledTimes(1);
    expect(mockRunnerRun).toHaveBeenCalledWith({ tenantId: 't1', experimentId: 'e1', provider: { id: 'provider-instance' }, userId: 'system' });
  });

  it('propagates a rejection from runner.run (no swallowing)', async () => {
    mockRunnerRun.mockRejectedValue(new Error('experiment blew up'));
    await expect(handleExperimentRun({ experimentId: 'e1', tenantId: 't1' })).rejects.toThrow('experiment blew up');
  });
});
