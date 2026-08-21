import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetConfig,
  mockRecordAudioMinutes,
  mockJobComplete,
  mockJobFail,
  mockSetWebhookResult,
  mockDeliverWithToken,
  mockUploadBuffer,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockRecordAudioMinutes: vi.fn(),
  mockJobComplete: vi.fn().mockResolvedValue({}),
  mockJobFail: vi.fn().mockResolvedValue({}),
  mockSetWebhookResult: vi.fn().mockResolvedValue({}),
  mockDeliverWithToken: vi.fn(),
  mockUploadBuffer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./transcription-model-service', () => ({
  TranscriptionModelService: vi.fn().mockImplementation(() => ({
    getConfig: mockGetConfig,
  })),
}));

vi.mock('./transcription-api-key-service', () => ({
  TranscriptionApiKeyService: { recordAudioMinutes: mockRecordAudioMinutes },
}));

vi.mock('./transcription-job-service', () => ({
  TranscriptionJobService: vi.fn().mockImplementation(() => ({
    complete: mockJobComplete,
    fail: mockJobFail,
    setWebhookResult: mockSetWebhookResult,
  })),
}));

vi.mock('./webhook-service', () => ({
  WebhookService: vi.fn().mockImplementation(() => ({
    deliverWithToken: mockDeliverWithToken,
  })),
}));

vi.mock('./s3-service', () => ({
  S3Service: vi.fn().mockImplementation(() => ({
    uploadBuffer: mockUploadBuffer,
  })),
}));

import { executeTranscription, type ExecuteTranscriptionParams, type TranscribeFn } from './transcription-runner';

const db = {} as any;

function baseParams(overrides: Partial<ExecuteTranscriptionParams> = {}): ExecuteTranscriptionParams {
  return {
    jobId: 'job-1',
    tenantId: 'tenant-1',
    tenantFolder: 'tenant-folder',
    apiKeyId: 'key-1',
    audio: Buffer.from('audio-bytes'),
    mimeType: 'audio/wav',
    fileName: 'call.wav',
    ...overrides,
  };
}

describe('executeTranscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockResolvedValue({
      endpointUrl: 'https://engine.example.com',
      contract: 'custom',
      modelId: 'whisper-large',
      credentials: null,
      resolvedVersionId: 'version-1',
    });
    mockDeliverWithToken.mockResolvedValue({ success: true, status: 200 });
    mockRecordAudioMinutes.mockResolvedValue(undefined);
  });

  describe('success path', () => {
    it('transcribes, persists output to S3, completes the job, and records audio minutes', async () => {
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({
        text: 'hello world',
        language: 'en',
        durationSec: 120,
      });

      const result = await executeTranscription(db, transcribe, baseParams());

      expect(transcribe).toHaveBeenCalledWith(
        expect.objectContaining({
          endpointUrl: 'https://engine.example.com',
          contract: 'custom',
          model: 'whisper-large',
          audio: Buffer.from('audio-bytes'),
          mimeType: 'audio/wav',
        })
      );

      expect(mockUploadBuffer).toHaveBeenCalledWith(
        'transcription/tenant-folder/job-1/output/output.json',
        expect.any(Buffer),
        'application/json'
      );

      expect(mockJobComplete).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          transcript: 'hello world',
          language: 'en',
          durationSec: 120,
          outputS3Key: 'transcription/tenant-folder/job-1/output/output.json',
          providerVersionId: 'version-1',
        })
      );

      expect(mockRecordAudioMinutes).toHaveBeenCalledWith(db, 'key-1', 2);

      expect(result).toMatchObject({
        text: 'hello world',
        language: 'en',
        durationSec: 120,
        outputS3Key: 'transcription/tenant-folder/job-1/output/output.json',
        languageDetected: false,
        languageDetectionConfidence: null,
      });
    });

    it('records audio minutes and delivers the webhook concurrently, not sequentially', async () => {
      const order: string[] = [];
      mockRecordAudioMinutes.mockImplementation(async () => {
        order.push('start-record');
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('end-record');
      });
      mockDeliverWithToken.mockImplementation(async () => {
        order.push('start-webhook');
        return { success: true, status: 200 };
      });
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({ text: 'hi', language: 'en', durationSec: 60 });

      await executeTranscription(db, transcribe, baseParams({ webhookUrl: 'https://client.example.com/hook' }));

      // The webhook call must start before recordAudioMinutes finishes — a sequential
      // `await recordAudioMinutes(); await deliverCompletionWebhook();` would always show
      // start-webhook AFTER end-record.
      expect(order.indexOf('start-webhook')).toBeLessThan(order.indexOf('end-record'));
    });

    it("does not throw and still delivers exactly one 'completed' webhook when recordAudioMinutes fails, since its failure is caught and logged internally", async () => {
      mockRecordAudioMinutes.mockRejectedValueOnce(new Error('usage service down'));
      mockDeliverWithToken.mockResolvedValue({ success: true, status: 200 });
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({ text: 'hi', language: 'en', durationSec: 60 });

      await expect(
        executeTranscription(db, transcribe, baseParams({ webhookUrl: 'https://client.example.com/hook' }))
      ).resolves.toBeDefined();

      expect(mockDeliverWithToken).toHaveBeenCalledTimes(1);
      const [, , payload] = mockDeliverWithToken.mock.calls[0];
      expect(payload).toMatchObject({ status: 'completed' });
    });

    it('passes engineTimeoutMs through to the transcribe call as timeoutMs', async () => {
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({ text: 'hi', durationSec: 5 });

      await executeTranscription(db, transcribe, baseParams({ engineTimeoutMs: 600_000 }));

      expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 600_000 }));
    });

    it('omits timeoutMs when engineTimeoutMs is not supplied', async () => {
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({ text: 'hi', durationSec: 5 });

      await executeTranscription(db, transcribe, baseParams());

      expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: undefined }));
    });

    it('includes segments and language-detection fields in the completed output when present', async () => {
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({
        text: 'नमस्ते',
        language: 'hi',
        durationSec: 30,
        segments: [{ text: 'नमस्ते', speaker: 'Speaker 1' }],
        languageDetected: true,
        languageDetectionConfidence: 0.92,
      });

      const result = await executeTranscription(db, transcribe, baseParams());

      expect(mockJobComplete).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          output: {
            segments: [{ text: 'नमस्ते', speaker: 'Speaker 1' }],
            languageDetected: true,
            languageDetectionConfidence: 0.92,
          },
        })
      );
      expect(result.languageDetected).toBe(true);
      expect(result.languageDetectionConfidence).toBe(0.92);
      expect(result.segments).toEqual([{ text: 'नमस्ते', speaker: 'Speaker 1' }]);
    });

    it('does not deliver a webhook when no webhookUrl is set', async () => {
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({ text: 'hi', durationSec: 5 });
      await executeTranscription(db, transcribe, baseParams({ webhookUrl: null }));
      expect(mockDeliverWithToken).not.toHaveBeenCalled();
      expect(mockSetWebhookResult).not.toHaveBeenCalled();
    });

    it('delivers a completed webhook with the bearer token and the original s3Key', async () => {
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({ text: 'hi', language: 'en', durationSec: 10 });

      await executeTranscription(
        db,
        transcribe,
        baseParams({
          webhookUrl: 'https://you.example.com/hook',
          webhookSecret: 'whsec_abc',
          s3Key: 'transcription/_uploads/tenant-1/x.wav',
        })
      );

      expect(mockDeliverWithToken).toHaveBeenCalledWith(
        'https://you.example.com/hook',
        'whsec_abc',
        expect.objectContaining({
          executionId: 'job-1',
          status: 'completed',
          input: { fileName: 'call.wav', mimeType: 'audio/wav', s3Key: 'transcription/_uploads/tenant-1/x.wav' },
          output: expect.objectContaining({ text: 'hi', language: 'en', durationSec: 10 }),
        })
      );
      expect(mockSetWebhookResult).toHaveBeenCalledWith('job-1', true);
    });

    it('includes segments in the completed webhook output when diarization returns them', async () => {
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({
        text: 'hi',
        language: 'en',
        durationSec: 10,
        segments: [{ start: 0, end: 1.2, speaker: 'Speaker 1', text: 'hi' }],
      });

      await executeTranscription(
        db,
        transcribe,
        baseParams({ webhookUrl: 'https://you.example.com/hook', diarize: true })
      );

      expect(mockDeliverWithToken).toHaveBeenCalledWith(
        'https://you.example.com/hook',
        null,
        expect.objectContaining({
          output: expect.objectContaining({
            segments: [{ start: 0, end: 1.2, speaker: 'Speaker 1', text: 'hi' }],
          }),
        })
      );
    });

    it('omits segments from the completed webhook output when not present', async () => {
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({ text: 'hi', language: 'en', durationSec: 10 });

      await executeTranscription(db, transcribe, baseParams({ webhookUrl: 'https://you.example.com/hook' }));

      const [, , payload] = mockDeliverWithToken.mock.calls[0];
      expect(payload.output).not.toHaveProperty('segments');
    });

    it('echoes uploadId and clientReference into the completed webhook', async () => {
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({ text: 'hi', language: 'en', durationSec: 10 });

      await executeTranscription(
        db,
        transcribe,
        baseParams({
          webhookUrl: 'https://you.example.com/hook',
          webhookSecret: 'whsec_abc',
          uploadId: 'up-1',
          clientReference: 'recording_8891',
        })
      );

      expect(mockDeliverWithToken).toHaveBeenCalledWith(
        'https://you.example.com/hook',
        'whsec_abc',
        expect.objectContaining({ uploadId: 'up-1', clientReference: 'recording_8891', status: 'completed' })
      );
    });

    it('omits uploadId/clientReference keys entirely when not supplied', async () => {
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({ text: 'hi', durationSec: 5 });

      await executeTranscription(db, transcribe, baseParams({ webhookUrl: 'https://you.example.com/hook' }));

      const payload = mockDeliverWithToken.mock.calls[0][2];
      expect('uploadId' in payload).toBe(false);
      expect('clientReference' in payload).toBe(false);
    });

    it('calls onWebhookFailure when the completed-webhook delivery fails', async () => {
      mockDeliverWithToken.mockResolvedValue({ success: false, error: 'timeout' });
      const onWebhookFailure = vi.fn().mockResolvedValue(undefined);
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({ text: 'hi', durationSec: 5 });

      await executeTranscription(
        db,
        transcribe,
        baseParams({ webhookUrl: 'https://you.example.com/hook', onWebhookFailure })
      );

      expect(mockSetWebhookResult).toHaveBeenCalledWith('job-1', false);
      expect(onWebhookFailure).toHaveBeenCalledWith('job-1');
    });

    it('still completes the job when S3 output persistence fails (best-effort)', async () => {
      mockUploadBuffer.mockRejectedValueOnce(new Error('S3 down'));
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({ text: 'hi', durationSec: 5 });

      const result = await executeTranscription(db, transcribe, baseParams());

      expect(result.outputS3Key).toBeNull();
      expect(mockJobComplete).toHaveBeenCalledWith('job-1', expect.objectContaining({ outputS3Key: null }));
    });
  });

  describe('failure path', () => {
    it('treats a getConfig timeout/failure the same as any other failure — marks failed, never calls transcribe', async () => {
      mockGetConfig.mockRejectedValue(new Error('Resolving model config timed out for tenant tenant-1'));
      const transcribe: TranscribeFn = vi.fn();

      await expect(
        executeTranscription(db, transcribe, baseParams({ webhookUrl: 'https://you.example.com/hook' }))
      ).rejects.toThrow('Resolving model config timed out for tenant tenant-1');

      expect(mockJobFail).toHaveBeenCalledWith('job-1', 'Resolving model config timed out for tenant tenant-1', expect.any(Number));
      expect(transcribe).not.toHaveBeenCalled();
    });

    it('marks the job failed, delivers a failed webhook, and rethrows the original error', async () => {
      const transcribe: TranscribeFn = vi.fn().mockRejectedValue(new Error('engine unreachable'));

      await expect(
        executeTranscription(
          db,
          transcribe,
          baseParams({ webhookUrl: 'https://you.example.com/hook', webhookSecret: 'whsec_abc', s3Key: 'transcription/_uploads/tenant-1/x.wav' })
        )
      ).rejects.toThrow('engine unreachable');

      expect(mockJobFail).toHaveBeenCalledWith('job-1', 'engine unreachable', expect.any(Number));
      expect(mockDeliverWithToken).toHaveBeenCalledWith(
        'https://you.example.com/hook',
        'whsec_abc',
        expect.objectContaining({
          executionId: 'job-1',
          status: 'failed',
          error: 'engine unreachable',
          input: { fileName: 'call.wav', mimeType: 'audio/wav', s3Key: 'transcription/_uploads/tenant-1/x.wav' },
        })
      );
    });

    it('replaces a circuit-breaker error with a plain customer-facing message on the webhook, but keeps the raw message internally', async () => {
      const circuitError = new Error('Transcription engine at engine.example:8010 is currently unreachable (retry in 15s)');
      circuitError.name = 'EngineCircuitOpenError';
      const transcribe: TranscribeFn = vi.fn().mockRejectedValue(circuitError);

      await expect(
        executeTranscription(
          db,
          transcribe,
          baseParams({ webhookUrl: 'https://you.example.com/hook', totalAttempts: 6 })
        )
      ).rejects.toThrow('currently unreachable');

      // The job row and our own logs keep the detailed internal message.
      expect(mockJobFail).toHaveBeenCalledWith(
        'job-1',
        'Transcription engine at engine.example:8010 is currently unreachable (retry in 15s)',
        expect.any(Number)
      );
      // The webhook gets a plain, unambiguous message — no "retry in Xs" on what is the
      // final attempt, and no internal host detail leaked to the caller.
      expect(mockDeliverWithToken).toHaveBeenCalledWith(
        'https://you.example.com/hook',
        null,
        expect.objectContaining({ error: 'Transcription engine unreachable after 6 attempts — not processed' })
      );
    });

    it('echoes uploadId and clientReference into the failure webhook too', async () => {
      const transcribe: TranscribeFn = vi.fn().mockRejectedValue(new Error('engine unreachable'));

      await expect(
        executeTranscription(
          db,
          transcribe,
          baseParams({ webhookUrl: 'https://you.example.com/hook', uploadId: 'up-2', clientReference: 'ref-2' })
        )
      ).rejects.toThrow('engine unreachable');

      expect(mockDeliverWithToken).toHaveBeenCalledWith(
        'https://you.example.com/hook',
        null,
        expect.objectContaining({ uploadId: 'up-2', clientReference: 'ref-2', status: 'failed' })
      );
    });

    it('does not attempt a webhook on failure when no webhookUrl is set', async () => {
      const transcribe: TranscribeFn = vi.fn().mockRejectedValue(new Error('boom'));
      await expect(executeTranscription(db, transcribe, baseParams({ webhookUrl: null }))).rejects.toThrow('boom');
      expect(mockDeliverWithToken).not.toHaveBeenCalled();
    });

    it('calls onWebhookFailure when the failure-webhook delivery itself fails', async () => {
      mockDeliverWithToken.mockResolvedValue({ success: false, error: 'timeout' });
      const onWebhookFailure = vi.fn().mockResolvedValue(undefined);
      const transcribe: TranscribeFn = vi.fn().mockRejectedValue(new Error('boom'));

      await expect(
        executeTranscription(db, transcribe, baseParams({ webhookUrl: 'https://you.example.com/hook', onWebhookFailure }))
      ).rejects.toThrow('boom');

      // Failure-path webhook delivery is fire-and-forget relative to the rethrow, so
      // let pending microtasks (the .then/.catch chain) flush before asserting.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onWebhookFailure).toHaveBeenCalledWith('job-1');
    });

    it('still rethrows the original error even if marking the job failed also throws', async () => {
      mockJobFail.mockRejectedValueOnce(new Error('db unavailable'));
      const transcribe: TranscribeFn = vi.fn().mockRejectedValue(new Error('engine unreachable'));

      await expect(executeTranscription(db, transcribe, baseParams())).rejects.toThrow('engine unreachable');
    });

    it('does not mark the job failed or notify when isFinalAttempt is false, but still rethrows for the caller to retry', async () => {
      const transcribe: TranscribeFn = vi.fn().mockRejectedValue(new Error('engine unreachable'));

      await expect(
        executeTranscription(
          db,
          transcribe,
          baseParams({ webhookUrl: 'https://you.example.com/hook', isFinalAttempt: false })
        )
      ).rejects.toThrow('engine unreachable');

      expect(mockJobFail).not.toHaveBeenCalled();
      expect(mockDeliverWithToken).not.toHaveBeenCalled();
    });

    it('marks failed and delivers the webhook when isFinalAttempt is explicitly true (same as the default)', async () => {
      const transcribe: TranscribeFn = vi.fn().mockRejectedValue(new Error('engine unreachable'));

      await expect(
        executeTranscription(
          db,
          transcribe,
          baseParams({ webhookUrl: 'https://you.example.com/hook', isFinalAttempt: true })
        )
      ).rejects.toThrow('engine unreachable');

      expect(mockJobFail).toHaveBeenCalledWith('job-1', 'engine unreachable', expect.any(Number));
      expect(mockDeliverWithToken).toHaveBeenCalled();
    });
  });

  describe('system announcement outcome', () => {
    it('completes the job with the known phrase and a systemAnnouncement output, without persisting to S3', async () => {
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({
        text: 'कृपया बाद में पुनः प्रयास करें',
        outcome: 'system_announcement',
        matchedVariant: 'hi',
        matchConfidence: 0.97,
      });

      const result = await executeTranscription(db, transcribe, baseParams());

      expect(mockUploadBuffer).not.toHaveBeenCalled();
      expect(mockJobComplete).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          transcript: 'कृपया बाद में पुनः प्रयास करें',
          language: 'hi',
          durationSec: null,
          outputS3Key: null,
          output: { systemAnnouncement: true, matchedVariant: 'hi', matchConfidence: 0.97 },
        })
      );
      expect(result).toMatchObject({
        text: 'कृपया बाद में पुनः प्रयास करें',
        language: 'hi',
        durationSec: null,
        segments: null,
        outputS3Key: null,
        languageDetected: false,
        languageDetectionConfidence: null,
      });
    });

    it('does not record audio minutes for a system announcement', async () => {
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({
        text: 'try again later',
        outcome: 'system_announcement',
        matchedVariant: 'en',
        matchConfidence: 0.9,
      });

      await executeTranscription(db, transcribe, baseParams());

      expect(mockRecordAudioMinutes).not.toHaveBeenCalled();
    });

    it('delivers a completed webhook with the systemAnnouncement output instead of a transcript', async () => {
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({
        text: 'try again later',
        outcome: 'system_announcement',
        matchedVariant: 'en',
        matchConfidence: 0.9,
      });

      await executeTranscription(
        db,
        transcribe,
        baseParams({ webhookUrl: 'https://you.example.com/hook', webhookSecret: 'whsec_abc' })
      );

      expect(mockDeliverWithToken).toHaveBeenCalledWith(
        'https://you.example.com/hook',
        'whsec_abc',
        expect.objectContaining({
          status: 'completed',
          output: { systemAnnouncement: true, matchedVariant: 'en', matchConfidence: 0.9 },
        })
      );
      expect(mockSetWebhookResult).toHaveBeenCalledWith('job-1', true);
    });

    it('sends maxSpeakers: 2 to the transcribe function when diarize is true', async () => {
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({ text: 'hi', durationSec: 5 });

      await executeTranscription(db, transcribe, baseParams({ diarize: true }));

      expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ diarize: true, maxSpeakers: 2 }));
    });

    it('omits maxSpeakers when diarize is not requested', async () => {
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({ text: 'hi', durationSec: 5 });

      await executeTranscription(db, transcribe, baseParams());

      expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ maxSpeakers: undefined }));
    });
  });
});
