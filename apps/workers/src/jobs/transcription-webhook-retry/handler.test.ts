import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindFirst, mockDeliverWithToken, mockSetWebhookResult } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockDeliverWithToken: vi.fn(),
  mockSetWebhookResult: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@chatbot/shared', () => ({
  getPrismaClient: vi.fn(() => ({
    transcriptionJob: { findFirst: mockFindFirst },
  })),
  TranscriptionJobService: vi.fn().mockImplementation(() => ({
    setWebhookResult: mockSetWebhookResult,
  })),
  WebhookService: vi.fn().mockImplementation(() => ({
    deliverWithToken: mockDeliverWithToken,
  })),
}));

vi.mock('../../lib/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { handleTranscriptionWebhookRetry } from './handler';

const payload = { jobId: 'job-1', tenantId: 'tenant-1' };

describe('handleTranscriptionWebhookRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetWebhookResult.mockResolvedValue(undefined);
  });

  it('validates the payload with the Zod schema', async () => {
    await expect(handleTranscriptionWebhookRetry({ jobId: 'job-1' })).rejects.toThrow();
  });

  it('does nothing when the job cannot be found for that tenant', async () => {
    mockFindFirst.mockResolvedValue(null);
    await handleTranscriptionWebhookRetry(payload);
    expect(mockDeliverWithToken).not.toHaveBeenCalled();
  });

  it('does nothing when the job has no webhookUrl configured', async () => {
    mockFindFirst.mockResolvedValue({ id: 'job-1', webhookUrl: null, status: 'completed', apiKey: { webhookSecret: null } });
    await handleTranscriptionWebhookRetry(payload);
    expect(mockDeliverWithToken).not.toHaveBeenCalled();
  });

  it('redelivers a completed job with its transcript in the output', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'job-1',
      tenantId: 'tenant-1',
      status: 'completed',
      webhookUrl: 'https://hook.example.com',
      fileName: 'call.wav',
      mimeType: 'audio/wav',
      transcript: 'hello world',
      language: 'en',
      durationSec: 42,
      error: null,
      latencyMs: 900,
      apiKey: { webhookSecret: 'whsec_abc' },
    });
    mockDeliverWithToken.mockResolvedValue({ success: true, status: 200 });

    await handleTranscriptionWebhookRetry(payload);

    expect(mockDeliverWithToken).toHaveBeenCalledWith(
      'https://hook.example.com',
      'whsec_abc',
      expect.objectContaining({
        executionId: 'job-1',
        status: 'completed',
        input: { fileName: 'call.wav', mimeType: 'audio/wav' },
        output: { text: 'hello world', language: 'en', durationSec: 42 },
      })
    );
    expect(mockSetWebhookResult).toHaveBeenCalledWith('job-1', true);
  });

  it('redelivers a system-announcement job with its stored output verbatim, not rebuilt from transcript/language/durationSec', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'job-1',
      tenantId: 'tenant-1',
      status: 'completed',
      webhookUrl: 'https://hook.example.com',
      fileName: 'call.wav',
      mimeType: 'audio/wav',
      transcript: 'known ivr phrase text',
      language: 'hi',
      durationSec: null,
      output: { systemAnnouncement: true, matchedVariant: 'hi', matchConfidence: 0.97 },
      error: null,
      latencyMs: 812,
      apiKey: { webhookSecret: 'whsec_abc' },
    });
    mockDeliverWithToken.mockResolvedValue({ success: true, status: 200 });

    await handleTranscriptionWebhookRetry(payload);

    expect(mockDeliverWithToken).toHaveBeenCalledWith(
      'https://hook.example.com',
      'whsec_abc',
      expect.objectContaining({
        executionId: 'job-1',
        status: 'completed',
        output: { systemAnnouncement: true, matchedVariant: 'hi', matchConfidence: 0.97 },
      })
    );
  });

  it('redelivers a failed job with the error message instead of output', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'job-1',
      tenantId: 'tenant-1',
      status: 'failed',
      webhookUrl: 'https://hook.example.com',
      fileName: 'call.wav',
      mimeType: 'audio/wav',
      transcript: null,
      language: null,
      durationSec: null,
      error: 'engine unreachable',
      latencyMs: null,
      apiKey: { webhookSecret: null },
    });
    mockDeliverWithToken.mockResolvedValue({ success: true, status: 200 });

    await handleTranscriptionWebhookRetry(payload);

    const call = mockDeliverWithToken.mock.calls[0];
    expect(call[1]).toBeNull(); // no webhook secret configured
    expect(call[2]).toMatchObject({ status: 'failed', error: 'engine unreachable' });
    expect(call[2].output).toBeUndefined();
  });

  it('falls back to a generic error message when a failed job has none recorded', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'job-1', tenantId: 'tenant-1', status: 'failed', webhookUrl: 'https://hook.example.com',
      fileName: null, mimeType: null, transcript: null, language: null, durationSec: null,
      error: null, latencyMs: null, apiKey: { webhookSecret: null },
    });
    mockDeliverWithToken.mockResolvedValue({ success: true, status: 200 });

    await handleTranscriptionWebhookRetry(payload);

    expect(mockDeliverWithToken.mock.calls[0][2].error).toBe('Transcription failed');
  });

  it('throws (to trigger a pg-boss retry) when the redelivery attempt itself fails and this is not the final attempt', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'job-1', tenantId: 'tenant-1', status: 'completed', webhookUrl: 'https://hook.example.com',
      fileName: 'call.wav', mimeType: 'audio/wav', transcript: 'hi', language: 'en', durationSec: 5,
      error: null, latencyMs: 100, apiKey: { webhookSecret: null },
    });
    mockDeliverWithToken.mockResolvedValue({ success: false, error: 'timeout', status: undefined });

    await expect(handleTranscriptionWebhookRetry(payload)).rejects.toThrow('Webhook redelivery failed: timeout');
    expect(mockSetWebhookResult).toHaveBeenCalledWith('job-1', false);
  });

  it('finalizes as undeliverable instead of throwing when isFinalAttempt is true and delivery still fails', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'job-1', tenantId: 'tenant-1', status: 'completed', webhookUrl: 'https://hook.example.com',
      fileName: 'call.wav', mimeType: 'audio/wav', transcript: 'hi', language: 'en', durationSec: 5,
      error: null, latencyMs: 100, apiKey: { webhookSecret: null },
    });
    mockDeliverWithToken.mockResolvedValue({ success: false, error: 'timeout', status: undefined });

    await expect(handleTranscriptionWebhookRetry({ ...payload, isFinalAttempt: true })).resolves.toBeUndefined();

    expect(mockSetWebhookResult).toHaveBeenCalledWith('job-1', false, true);
  });

  it('sets webhookResult(id, true) on a successful delivery', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'job-1', tenantId: 'tenant-1', status: 'completed', webhookUrl: 'https://hook.example.com',
      fileName: 'call.wav', mimeType: 'audio/wav', transcript: 'hi', language: 'en', durationSec: 5,
      error: null, latencyMs: 100, apiKey: { webhookSecret: null },
    });
    mockDeliverWithToken.mockResolvedValue({ success: true, status: 200 });

    await handleTranscriptionWebhookRetry(payload);

    expect(mockSetWebhookResult).toHaveBeenCalledWith('job-1', true);
  });
});
