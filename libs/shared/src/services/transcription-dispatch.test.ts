import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockJobServiceCreate, mockMoveObject, mockDownloadAsBuffer, mockExecuteTranscription } = vi.hoisted(() => ({
  mockJobServiceCreate: vi.fn(),
  mockMoveObject: vi.fn(),
  mockDownloadAsBuffer: vi.fn(),
  mockExecuteTranscription: vi.fn(),
}));

vi.mock('./transcription-job-service', () => ({
  TranscriptionJobService: vi.fn().mockImplementation(() => ({
    create: mockJobServiceCreate,
  })),
}));

vi.mock('./s3-service', () => ({
  S3Service: vi.fn().mockImplementation(() => ({
    moveObject: mockMoveObject,
    downloadAsBuffer: mockDownloadAsBuffer,
  })),
}));

vi.mock('./transcription-runner', () => ({
  executeTranscription: mockExecuteTranscription,
}));

import { dispatchUploadedTranscription, PayloadTooLargeError } from './transcription-dispatch';

function mockDb() {
  return {
    transcriptionJob: { update: vi.fn().mockResolvedValue({}) },
  } as any;
}

describe('dispatchUploadedTranscription', () => {
  let enqueue: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    enqueue = vi.fn().mockResolvedValue(undefined);
  });

  describe('async (sync: false)', () => {
    it('creates a queued job, stages the s3 object, and enqueues the transcription job', async () => {
      mockJobServiceCreate.mockResolvedValue({ id: 'job-1' });
      const db = mockDb();

      const result = await dispatchUploadedTranscription({
        db,
        transcribe: vi.fn(),
        enqueue,
        tenantId: 'tenant-1',
        tenantFolder: 'tenant-folder',
        apiKeyId: 'key-1',
        jobConfigId: null,
        resolvedJobConfig: null,
        s3Key: 'transcription/_uploads/tenant-1/abc-call.wav',
        mimeType: 'audio/wav',
        fileName: 'call.wav',
        sync: false,
        maxBytes: 25 * 1024 * 1024,
      });

      expect(result).toEqual({
        sync: false,
        id: 'job-1',
        status: 'queued',
        statusUrl: '/api/v1/transcription/jobs/job-1',
      });

      expect(mockJobServiceCreate).toHaveBeenCalledWith(
        expect.objectContaining({ apiKeyId: 'key-1', tenantId: 'tenant-1', source: 'upload', status: 'queued' })
      );
      expect(mockMoveObject).toHaveBeenCalledWith(
        'transcription/_uploads/tenant-1/abc-call.wav',
        'transcription/tenant-folder/job-1/input/call.wav'
      );
      expect(db.transcriptionJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          s3Key: 'transcription/tenant-folder/job-1/input/call.wav',
          inputS3Key: 'transcription/tenant-folder/job-1/input/call.wav',
        },
      });
      expect(enqueue).toHaveBeenCalledWith(
        'transcription',
        expect.objectContaining({
          jobId: 'job-1',
          source: 'upload',
          s3Key: 'transcription/_uploads/tenant-1/abc-call.wav',
          stashKey: 'transcription/tenant-folder/job-1/input/call.wav',
        })
      );
      // Sync execution must never run on the async path.
      expect(mockExecuteTranscription).not.toHaveBeenCalled();
      expect(mockDownloadAsBuffer).not.toHaveBeenCalled();
    });

    it('records uploadId on the job and forwards uploadId + clientReference to the queue', async () => {
      mockJobServiceCreate.mockResolvedValue({ id: 'job-9' });

      await dispatchUploadedTranscription({
        db: mockDb(),
        transcribe: vi.fn(),
        enqueue,
        tenantId: 'tenant-1',
        tenantFolder: 'tenant-folder',
        apiKeyId: 'key-1',
        jobConfigId: null,
        resolvedJobConfig: null,
        s3Key: 'transcription/_uploads/tenant-1/x.wav',
        mimeType: 'audio/wav',
        fileName: 'x.wav',
        uploadId: 'up-1',
        clientReference: 'recording_8891',
        sync: false,
        maxBytes: 25 * 1024 * 1024,
      });

      expect(mockJobServiceCreate).toHaveBeenCalledWith(expect.objectContaining({ uploadId: 'up-1' }));
      expect(enqueue).toHaveBeenCalledWith(
        'transcription',
        expect.objectContaining({ uploadId: 'up-1', clientReference: 'recording_8891' })
      );
    });

    it('sends null (not undefined) for uploadId/clientReference when absent', async () => {
      mockJobServiceCreate.mockResolvedValue({ id: 'job-10' });

      await dispatchUploadedTranscription({
        db: mockDb(),
        transcribe: vi.fn(),
        enqueue,
        tenantId: 'tenant-1',
        tenantFolder: 'tenant-folder',
        apiKeyId: 'key-1',
        jobConfigId: null,
        resolvedJobConfig: null,
        s3Key: 'transcription/_uploads/tenant-1/x.wav',
        mimeType: 'audio/wav',
        sync: false,
        maxBytes: 25 * 1024 * 1024,
      });

      const payload = enqueue.mock.calls[0][1];
      expect(payload.uploadId).toBeNull();
      expect(payload.clientReference).toBeNull();
    });

    it('resolves modelId/versionId/language/diarize from the job config when not overridden per-request', async () => {
      mockJobServiceCreate.mockResolvedValue({ id: 'job-2' });

      await dispatchUploadedTranscription({
        db: mockDb(),
        transcribe: vi.fn(),
        enqueue,
        tenantId: 'tenant-1',
        tenantFolder: 'tenant-folder',
        apiKeyId: 'key-1',
        jobConfigId: 'jc-1',
        resolvedJobConfig: { modelId: 'model-from-config', versionId: 'version-from-config', config: { language: 'hi', diarize: true } },
        keyModelId: 'model-from-key',
        s3Key: 'transcription/_uploads/tenant-1/x.wav',
        mimeType: 'audio/wav',
        fileName: 'x.wav',
        sync: false,
        maxBytes: 25 * 1024 * 1024,
      });

      expect(mockJobServiceCreate).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'model-from-config', providerVersionId: 'version-from-config' })
      );
      expect(enqueue).toHaveBeenCalledWith(
        'transcription',
        expect.objectContaining({ language: 'hi', diarize: true, modelId: 'model-from-config', versionId: 'version-from-config' })
      );
    });

    it('lets a per-request modelId/language/diarize override the job config defaults', async () => {
      mockJobServiceCreate.mockResolvedValue({ id: 'job-3' });

      await dispatchUploadedTranscription({
        db: mockDb(),
        transcribe: vi.fn(),
        enqueue,
        tenantId: 'tenant-1',
        tenantFolder: 'tenant-folder',
        apiKeyId: 'key-1',
        jobConfigId: 'jc-1',
        resolvedJobConfig: { modelId: 'model-from-config', versionId: 'version-from-config', config: { language: 'hi', diarize: true } },
        modelId: 'model-override',
        language: 'en',
        diarize: false,
        s3Key: 'transcription/_uploads/tenant-1/x.wav',
        mimeType: 'audio/wav',
        fileName: 'x.wav',
        sync: false,
        maxBytes: 25 * 1024 * 1024,
      });

      expect(enqueue).toHaveBeenCalledWith(
        'transcription',
        expect.objectContaining({ language: 'en', diarize: false, modelId: 'model-override' })
      );
    });

    it('prefers the per-request webhookUrl over the key default', async () => {
      mockJobServiceCreate.mockResolvedValue({ id: 'job-4' });

      await dispatchUploadedTranscription({
        db: mockDb(),
        transcribe: vi.fn(),
        enqueue,
        tenantId: 'tenant-1',
        tenantFolder: 'tenant-folder',
        apiKeyId: 'key-1',
        jobConfigId: null,
        resolvedJobConfig: null,
        keyWebhookUrl: 'https://key-default.example.com/hook',
        webhookUrl: 'https://per-request.example.com/hook',
        s3Key: 'transcription/_uploads/tenant-1/x.wav',
        mimeType: 'audio/wav',
        sync: false,
        maxBytes: 25 * 1024 * 1024,
      });

      expect(mockJobServiceCreate).toHaveBeenCalledWith(
        expect.objectContaining({ webhookUrl: 'https://per-request.example.com/hook' })
      );
    });
  });

  describe('sync (sync: true)', () => {
    it('downloads the audio, runs executeTranscription, and returns the transcript inline', async () => {
      mockDownloadAsBuffer.mockResolvedValue(Buffer.from('fake-audio-bytes'));
      mockJobServiceCreate.mockResolvedValue({ id: 'job-5' });
      mockExecuteTranscription.mockResolvedValue({
        text: 'hello world',
        language: 'en',
        durationSec: 120,
        segments: [{ text: 'hello world', speaker: 'Speaker 1' }],
        outputS3Key: 'transcription/tenant-folder/job-5/output/output.json',
        languageDetected: false,
        languageDetectionConfidence: null,
      });

      const result = await dispatchUploadedTranscription({
        db: mockDb(),
        transcribe: vi.fn(),
        enqueue,
        tenantId: 'tenant-1',
        tenantFolder: 'tenant-folder',
        apiKeyId: 'key-1',
        jobConfigId: null,
        resolvedJobConfig: null,
        s3Key: 'transcription/_uploads/tenant-1/x.wav',
        mimeType: 'audio/wav',
        fileName: 'x.wav',
        sync: true,
        maxBytes: 25 * 1024 * 1024,
      });

      expect(mockDownloadAsBuffer).toHaveBeenCalledWith('transcription/_uploads/tenant-1/x.wav');
      expect(mockMoveObject).toHaveBeenCalledWith(
        'transcription/_uploads/tenant-1/x.wav',
        'transcription/tenant-folder/job-5/input/x.wav'
      );
      expect(mockExecuteTranscription).toHaveBeenCalledTimes(1);
      const executeArgs = mockExecuteTranscription.mock.calls[0][2];
      expect(executeArgs.jobId).toBe('job-5');
      expect(executeArgs.s3Key).toBe('transcription/_uploads/tenant-1/x.wav');
      expect(executeArgs.engineTimeoutMs).toBe(120_000);

      expect(result).toEqual({
        sync: true,
        id: 'job-5',
        systemAnnouncement: false,
        text: 'hello world',
        language: 'en',
        languageDetected: false,
        languageDetectionConfidence: null,
        durationSec: 120,
        segments: [{ text: 'hello world', speaker: 'Speaker 1' }],
        outputS3Key: 'transcription/tenant-folder/job-5/output/output.json',
        audioMinutes: 2,
      });
    });

    it('passes uploadId + clientReference into executeTranscription so the webhook can echo them', async () => {
      mockDownloadAsBuffer.mockResolvedValue(Buffer.from('bytes'));
      mockJobServiceCreate.mockResolvedValue({ id: 'job-11' });
      mockExecuteTranscription.mockResolvedValue({
        text: 'hi', language: 'en', durationSec: 5, segments: null,
        outputS3Key: null, languageDetected: false, languageDetectionConfidence: null,
      });

      await dispatchUploadedTranscription({
        db: mockDb(),
        transcribe: vi.fn(),
        enqueue,
        tenantId: 'tenant-1',
        tenantFolder: 'tenant-folder',
        apiKeyId: 'key-1',
        jobConfigId: null,
        resolvedJobConfig: null,
        s3Key: 'transcription/_uploads/tenant-1/x.wav',
        mimeType: 'audio/wav',
        uploadId: 'up-2',
        clientReference: 'ref-2',
        sync: true,
        maxBytes: 25 * 1024 * 1024,
      });

      const params = mockExecuteTranscription.mock.calls[0][2];
      expect(params.uploadId).toBe('up-2');
      expect(params.clientReference).toBe('ref-2');
      expect(mockJobServiceCreate).toHaveBeenCalledWith(expect.objectContaining({ uploadId: 'up-2' }));
    });

    it('routes a failed webhook to the injected enqueue as a retry job', async () => {
      mockDownloadAsBuffer.mockResolvedValue(Buffer.from('bytes'));
      mockJobServiceCreate.mockResolvedValue({ id: 'job-12' });
      mockExecuteTranscription.mockResolvedValue({
        text: 'hi', language: null, durationSec: null, segments: null,
        outputS3Key: null, languageDetected: false, languageDetectionConfidence: null,
      });

      await dispatchUploadedTranscription({
        db: mockDb(),
        transcribe: vi.fn(),
        enqueue,
        tenantId: 'tenant-1',
        tenantFolder: 'tenant-folder',
        apiKeyId: 'key-1',
        jobConfigId: null,
        resolvedJobConfig: null,
        s3Key: 'transcription/_uploads/tenant-1/x.wav',
        mimeType: 'audio/wav',
        sync: true,
        maxBytes: 25 * 1024 * 1024,
      });

      const onWebhookFailure = mockExecuteTranscription.mock.calls[0][2].onWebhookFailure;
      await onWebhookFailure('job-12');

      expect(enqueue).toHaveBeenCalledWith('transcription-webhook-retry', { jobId: 'job-12', tenantId: 'tenant-1' });
    });

    it('throws PayloadTooLargeError and never creates a job when the object exceeds maxBytes', async () => {
      mockDownloadAsBuffer.mockResolvedValue(Buffer.alloc(100));

      await expect(
        dispatchUploadedTranscription({
          db: mockDb(),
          transcribe: vi.fn(),
          enqueue,
          tenantId: 'tenant-1',
          tenantFolder: 'tenant-folder',
          apiKeyId: 'key-1',
          jobConfigId: null,
          resolvedJobConfig: null,
          s3Key: 'transcription/_uploads/tenant-1/huge.wav',
          mimeType: 'audio/wav',
          sync: true,
          maxBytes: 50,
        })
      ).rejects.toThrow(PayloadTooLargeError);

      expect(mockJobServiceCreate).not.toHaveBeenCalled();
      expect(mockExecuteTranscription).not.toHaveBeenCalled();
    });

    it('computes audioMinutes as 0 when durationSec is not reported', async () => {
      mockDownloadAsBuffer.mockResolvedValue(Buffer.from('bytes'));
      mockJobServiceCreate.mockResolvedValue({ id: 'job-6' });
      mockExecuteTranscription.mockResolvedValue({
        text: 'hi',
        language: null,
        durationSec: null,
        segments: null,
        outputS3Key: null,
        languageDetected: false,
        languageDetectionConfidence: null,
      });

      const result = await dispatchUploadedTranscription({
        db: mockDb(),
        transcribe: vi.fn(),
        enqueue,
        tenantId: 'tenant-1',
        tenantFolder: 'tenant-folder',
        apiKeyId: 'key-1',
        jobConfigId: null,
        resolvedJobConfig: null,
        s3Key: 'transcription/_uploads/tenant-1/x.wav',
        mimeType: 'audio/wav',
        sync: true,
        maxBytes: 25 * 1024 * 1024,
      });

      expect(result.audioMinutes).toBe(0);
    });
  });
});
