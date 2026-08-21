import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranscriptionJobVersionService } from './transcription-job-version-service';

function mockDb() {
  return {
    transcriptionJobVersion: {
      count: vi.fn(async () => 0),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'v-1', ...args.data })),
      findFirst: vi.fn(async () => ({ id: 'v-1', jobConfigId: 'jc-1' })),
      findMany: vi.fn(async () => []),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'v-1', ...args.data })),
    },
  };
}

describe('TranscriptionJobVersionService', () => {
  let db: ReturnType<typeof mockDb>;
  let service: TranscriptionJobVersionService;

  beforeEach(() => {
    db = mockDb();
    service = new TranscriptionJobVersionService(db as any);
  });

  describe('create', () => {
    it('numbers the new version as count+1 and starts it as draft', async () => {
      db.transcriptionJobVersion.count.mockResolvedValue(4);
      const result = await service.create('jc-1', { language: 'hi', diarize: true }, 'notes');

      expect(db.transcriptionJobVersion.create).toHaveBeenCalledWith({
        data: {
          jobConfigId: 'jc-1',
          version: 5,
          config: { language: 'hi', diarize: true },
          status: 'draft',
          changeNotes: 'notes',
        },
      });
      expect(result.version).toBe(5);
    });

    it('re-throws and logs when the create fails', async () => {
      db.transcriptionJobVersion.create.mockRejectedValue(new Error('db down'));
      await expect(service.create('jc-1', {})).rejects.toThrow('db down');
    });
  });

  it('findById looks up a single version by id', async () => {
    await service.findById('v-1');
    expect(db.transcriptionJobVersion.findFirst).toHaveBeenCalledWith({ where: { id: 'v-1' } });
  });

  it('findByJobConfigId lists versions newest-first', async () => {
    await service.findByJobConfigId('jc-1');
    expect(db.transcriptionJobVersion.findMany).toHaveBeenCalledWith({
      where: { jobConfigId: 'jc-1' },
      orderBy: { version: 'desc' },
    });
  });

  it('publish sets status to published', async () => {
    const result = await service.publish('v-1');
    expect(db.transcriptionJobVersion.update).toHaveBeenCalledWith({ where: { id: 'v-1' }, data: { status: 'published' } });
    expect(result.status).toBe('published');
  });

  it('archive sets status to archived', async () => {
    const result = await service.archive('v-1');
    expect(db.transcriptionJobVersion.update).toHaveBeenCalledWith({ where: { id: 'v-1' }, data: { status: 'archived' } });
    expect(result.status).toBe('archived');
  });
});
