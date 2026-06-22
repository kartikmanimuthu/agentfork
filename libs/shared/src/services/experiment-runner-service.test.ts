import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInferenceRun = vi.fn();
vi.mock('./experiment-inference-service', () => ({
  ExperimentInferenceService: vi.fn().mockImplementation(() => ({ run: mockInferenceRun })),
}));

import { ExperimentRunnerService } from './experiment-runner-service';

const mockDb = {
  experiment: { findFirst: vi.fn(), update: vi.fn() },
  datasetItem: { findMany: vi.fn() },
  experimentRunItem: { create: vi.fn(), update: vi.fn() },
};

const mockProvider = {} as any;

describe('ExperimentRunnerService', () => {
  let service: ExperimentRunnerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ExperimentRunnerService(mockDb as any);
  });

  it('throws when experiment is not found', async () => {
    mockDb.experiment.findFirst.mockResolvedValue(null);
    await expect(
      service.run({ tenantId: 't1', experimentId: 'e1', provider: mockProvider, userId: 'u1' }),
    ).rejects.toThrow('Experiment not found');
  });

  it('runs every (datasetItem x agentVersionId) pair and completes successfully', async () => {
    mockDb.experiment.findFirst.mockResolvedValue({
      id: 'e1', tenantId: 't1', datasetId: 'd1', agentVersionIds: ['v1', 'v2'], scoreConfigIds: ['c1'], status: 'DRAFT',
    });
    mockDb.datasetItem.findMany.mockResolvedValue([{ id: 'i1', input: {} }, { id: 'i2', input: {} }]);
    mockDb.experimentRunItem.create.mockResolvedValue({ id: 'ri1' });
    mockInferenceRun.mockResolvedValue({ outputText: 'ok', outputJson: {}, latencyMs: 10, tokenUsage: {}, inferenceSessionId: 's1' });

    await service.run({ tenantId: 't1', experimentId: 'e1', provider: mockProvider, userId: 'u1' });

    expect(mockDb.experiment.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { status: 'RUNNING' } });
    expect(mockDb.experimentRunItem.create).toHaveBeenCalledTimes(4); // 2 items x 2 versions
    expect(mockDb.experimentRunItem.update).toHaveBeenCalledTimes(4);
    expect(mockDb.experiment.update).toHaveBeenLastCalledWith({ where: { id: 'e1' }, data: { status: 'COMPLETED' } });
  });

  it('marks only the failing run item FAILED while others complete', async () => {
    mockDb.experiment.findFirst.mockResolvedValue({
      id: 'e1', tenantId: 't1', datasetId: 'd1', agentVersionIds: ['v1'], scoreConfigIds: ['c1'], status: 'DRAFT',
    });
    mockDb.datasetItem.findMany.mockResolvedValue([{ id: 'i1', input: {} }, { id: 'i2', input: {} }]);
    mockDb.experimentRunItem.create.mockResolvedValueOnce({ id: 'ri1' }).mockResolvedValueOnce({ id: 'ri2' });
    mockInferenceRun
      .mockResolvedValueOnce({ outputText: 'ok', outputJson: {}, latencyMs: 10, tokenUsage: {}, inferenceSessionId: 's1' })
      .mockRejectedValueOnce(new Error('boom'));

    await service.run({ tenantId: 't1', experimentId: 'e1', provider: mockProvider, userId: 'u1' });

    expect(mockDb.experimentRunItem.update).toHaveBeenCalledWith({ where: { id: 'ri1' }, data: expect.objectContaining({ status: 'COMPLETED' }) });
    expect(mockDb.experimentRunItem.update).toHaveBeenCalledWith({ where: { id: 'ri2' }, data: expect.objectContaining({ status: 'FAILED', error: 'boom' }) });
    expect(mockDb.experiment.update).toHaveBeenLastCalledWith({ where: { id: 'e1' }, data: { status: 'COMPLETED' } });
  });

  it('marks the experiment FAILED when every item fails', async () => {
    mockDb.experiment.findFirst.mockResolvedValue({
      id: 'e1', tenantId: 't1', datasetId: 'd1', agentVersionIds: ['v1'], scoreConfigIds: ['c1'], status: 'DRAFT',
    });
    mockDb.datasetItem.findMany.mockResolvedValue([{ id: 'i1', input: {} }]);
    mockDb.experimentRunItem.create.mockResolvedValue({ id: 'ri1' });
    mockInferenceRun.mockRejectedValue(new Error('boom'));

    await service.run({ tenantId: 't1', experimentId: 'e1', provider: mockProvider, userId: 'u1' });

    expect(mockDb.experiment.update).toHaveBeenLastCalledWith({ where: { id: 'e1' }, data: { status: 'FAILED' } });
  });

  it('propagates an error if experiment.findFirst itself throws', async () => {
    mockDb.experiment.findFirst.mockRejectedValue(new Error('db down'));
    await expect(
      service.run({ tenantId: 't1', experimentId: 'e1', provider: mockProvider, userId: 'u1' }),
    ).rejects.toThrow('db down');
  });
});
