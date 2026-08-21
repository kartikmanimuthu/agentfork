import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranscriptionJobConfigService } from './transcription-job-config-service';

function mockDb() {
  return {
    transcriptionJobConfig: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'jc-1', ...args.data })),
      findFirst: vi.fn(async () => ({ id: 'jc-1', tenantId: 'tenant-1', name: 'My Job' })),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'jc-1', ...args.data })),
      delete: vi.fn(async () => ({ id: 'jc-1' })),
    },
    transcriptionModel: {
      findFirst: vi.fn(async () => ({ id: 'model-1' })),
    },
    transcriptionModelVersion: {
      findFirst: vi.fn(async () => ({ model: { tenantId: 'tenant-1' } })),
    },
  };
}

describe('TranscriptionJobConfigService', () => {
  let db: ReturnType<typeof mockDb>;
  let service: TranscriptionJobConfigService;

  beforeEach(() => {
    db = mockDb();
    service = new TranscriptionJobConfigService('tenant-1', db as any);
  });

  describe('create', () => {
    it('creates a draft config with the tenant scoped in', async () => {
      const result = await service.create({ name: 'My Job' });

      expect(db.transcriptionJobConfig.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tenantId: 'tenant-1', name: 'My Job', status: 'draft' }),
      });
      expect(result.id).toBe('jc-1');
    });

    it('validates the modelId belongs to the tenant before creating', async () => {
      await service.create({ name: 'My Job', modelId: 'model-1' });
      expect(db.transcriptionModel.findFirst).toHaveBeenCalledWith({
        where: { id: 'model-1', tenantId: 'tenant-1' },
        select: { id: true },
      });
    });

    it('throws and never creates when the modelId does not belong to the tenant', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue(null);
      await expect(service.create({ name: 'My Job', modelId: 'other-tenant-model' })).rejects.toThrow(
        'Transcription model not found'
      );
      expect(db.transcriptionJobConfig.create).not.toHaveBeenCalled();
    });

    it('throws when versionId belongs to a model owned by a different tenant', async () => {
      db.transcriptionModelVersion.findFirst.mockResolvedValue({ model: { tenantId: 'other-tenant' } });
      await expect(service.create({ name: 'My Job', versionId: 'v-1' })).rejects.toThrow(
        'Transcription model version not found'
      );
      expect(db.transcriptionJobConfig.create).not.toHaveBeenCalled();
    });
  });

  it('findById scopes the query to the tenant and includes model/version', async () => {
    await service.findById('jc-1');
    expect(db.transcriptionJobConfig.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'jc-1', tenantId: 'tenant-1' } })
    );
  });

  describe('findMany', () => {
    it('filters by tenant and status', async () => {
      await service.findMany({ status: 'active' });
      expect(db.transcriptionJobConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-1', status: 'active' } })
      );
    });

    it('applies a case-insensitive search across name/description', async () => {
      await service.findMany({ search: 'call' });
      const call = db.transcriptionJobConfig.findMany.mock.calls[0][0];
      expect(call.where.OR).toEqual([
        { name: { contains: 'call', mode: 'insensitive' } },
        { description: { contains: 'call', mode: 'insensitive' } },
      ]);
    });

    it('paginates using page/pageSize', async () => {
      await service.findMany({ page: 3, pageSize: 10 });
      expect(db.transcriptionJobConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 })
      );
    });
  });

  describe('update', () => {
    it('only writes fields explicitly provided', async () => {
      await service.update('jc-1', { name: 'Renamed' });
      const data = db.transcriptionJobConfig.update.mock.calls[0][0].data;
      expect(data).toEqual({ name: 'Renamed' });
    });

    it('re-validates modelId/versionId ownership on update', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue(null);
      await expect(service.update('jc-1', { modelId: 'bad-model' })).rejects.toThrow('Transcription model not found');
      expect(db.transcriptionJobConfig.update).not.toHaveBeenCalled();
    });

    it('is scoped to the tenant', async () => {
      await service.update('jc-1', { status: 'active' });
      expect(db.transcriptionJobConfig.update).toHaveBeenCalledWith({
        where: { id: 'jc-1', tenantId: 'tenant-1' },
        data: { status: 'active' },
      });
    });
  });

  it('delete is scoped to the tenant', async () => {
    await service.delete('jc-1');
    expect(db.transcriptionJobConfig.delete).toHaveBeenCalledWith({ where: { id: 'jc-1', tenantId: 'tenant-1' } });
  });

  describe('resolveConfig', () => {
    it('returns the config when found', async () => {
      const result = await service.resolveConfig('jc-1');
      expect(result.id).toBe('jc-1');
    });

    it('throws when the config does not exist', async () => {
      db.transcriptionJobConfig.findFirst.mockResolvedValue(null);
      await expect(service.resolveConfig('missing')).rejects.toThrow('Transcription job config not found');
    });
  });
});
