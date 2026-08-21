import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranscriptionModelVersionService } from './transcription-model-version-service';

function mockDb() {
  return {
    transcriptionModel: {
      findFirst: vi.fn(async () => ({ id: 'model-1' })),
      findUniqueOrThrow: vi.fn(async () => ({
        id: 'model-1',
        providerType: 'CUSTOM',
        contract: 'custom',
        endpointUrl: 'https://engine.example.com',
        region: null,
        modelId: 'whisper-large',
        config: { temperature: 0 },
      })),
      update: vi.fn(async () => ({})),
    },
    transcriptionModelVersion: {
      count: vi.fn(async () => 0),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'v-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...args.data,
      })),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => ({ id: 'v-1', modelId: 'model-1' })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'v-1', modelId: 'model-1', ...args.data })),
    },
  };
}

describe('TranscriptionModelVersionService', () => {
  let db: ReturnType<typeof mockDb>;
  let service: TranscriptionModelVersionService;

  beforeEach(() => {
    db = mockDb();
    service = new TranscriptionModelVersionService('tenant-1', db as any);
  });

  describe('create', () => {
    it('throws when the model does not belong to the tenant', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue(null);
      await expect(service.create('model-1')).rejects.toThrow('Transcription model not found');
      expect(db.transcriptionModelVersion.create).not.toHaveBeenCalled();
    });

    it('snapshots the model live config as version count+1, starting as draft', async () => {
      db.transcriptionModelVersion.count.mockResolvedValue(2);
      const result = await service.create('model-1', 'initial snapshot');

      expect(db.transcriptionModelVersion.create).toHaveBeenCalledWith({
        data: {
          modelId: 'model-1',
          version: 3,
          status: 'draft',
          config: {
            providerType: 'CUSTOM',
            contract: 'custom',
            endpointUrl: 'https://engine.example.com',
            region: null,
            modelId: 'whisper-large',
            config: { temperature: 0 },
          },
          changeNotes: 'initial snapshot',
          createdBy: 'system',
        },
      });
      expect(result.version).toBe(3);
      expect(result.status).toBe('draft');
    });
  });

  describe('list', () => {
    it('throws when the model does not belong to the tenant', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue(null);
      await expect(service.list('model-1')).rejects.toThrow('Transcription model not found');
    });

    it('lists versions newest-first', async () => {
      await service.list('model-1');
      expect(db.transcriptionModelVersion.findMany).toHaveBeenCalledWith({
        where: { modelId: 'model-1' },
        orderBy: { version: 'desc' },
      });
    });
  });

  describe('publish', () => {
    it('returns null when the version does not exist under that model', async () => {
      db.transcriptionModelVersion.findFirst.mockResolvedValue(null);
      const result = await service.publish('model-1', 'missing-version');
      expect(result).toBeNull();
      expect(db.transcriptionModelVersion.update).not.toHaveBeenCalled();
    });

    it('marks the version published and points the model at it as activeVersionId', async () => {
      const result = await service.publish('model-1', 'v-1');

      expect(db.transcriptionModelVersion.update).toHaveBeenCalledWith({
        where: { id: 'v-1' },
        data: { status: 'published' },
      });
      expect(db.transcriptionModel.update).toHaveBeenCalledWith({
        where: { id: 'model-1' },
        data: { activeVersionId: 'v-1' },
      });
      expect(result?.status).toBe('published');
    });

    it('throws when the model does not belong to the tenant', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue(null);
      await expect(service.publish('model-1', 'v-1')).rejects.toThrow('Transcription model not found');
    });
  });
});
