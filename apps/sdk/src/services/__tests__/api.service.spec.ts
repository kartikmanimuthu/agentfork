import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiService } from '../api.service';

describe('ApiService', () => {
  let service: ApiService;
  const baseUrl = 'https://example.com';
  const apiKey = 'smc_testkey123';

  beforeEach(() => {
    service = new ApiService(baseUrl, apiKey);
    vi.stubGlobal('fetch', vi.fn());
  });

  describe('createSession', () => {
    it('sends POST with correct body and headers', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'sess_1' }),
      });

      const result = await service.createSession({ visitorId: 'v_abc' });

      expect(result).toEqual({ id: 'sess_1' });
      const [url, init] = (fetch as any).mock.calls[0];
      expect(url).toBe(`${baseUrl}/api/v1/inference/sessions`);
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      });
      const body = JSON.parse(init.body);
      expect(body).toMatchObject({ channel: 'SDK', visitorId: 'v_abc' });
    });

    it('includes optional visitorName, visitorEmail, and metadata', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'sess_2' }),
      });

      await service.createSession({
        visitorId: 'v_abc',
        visitorName: 'John',
        visitorEmail: 'john@example.com',
        metadata: { source: 'homepage' },
      });

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.visitorName).toBe('John');
      expect(body.visitorEmail).toBe('john@example.com');
      expect(body.metadata).toEqual({ source: 'homepage' });
    });

    it('throws error on non-OK response', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 400,
      });

      await expect(service.createSession({ visitorId: 'v_abc' })).rejects.toThrow(
        'Session creation failed: 400',
      );
    });
  });

  describe('getSession', () => {
    it('returns session with messages on 200', async () => {
      const sessionData = {
        id: 'sess_1',
        status: 'active',
        messages: [
          { id: 'msg_1', role: 'user', content: 'Hello', createdAt: '2024-01-01T00:00:00Z' },
        ],
      };
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(sessionData),
      });

      const result = await service.getSession('sess_1');
      expect(result).toEqual(sessionData);
    });

    it('returns null on 410 Gone (expired session)', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 410,
      });

      const result = await service.getSession('sess_1');
      expect(result).toBeNull();
    });

    it('throws error on other non-OK status', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(service.getSession('sess_1')).rejects.toThrow('Session fetch failed: 500');
    });

    it('sends GET with correct auth headers', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'sess_1', status: 'active', messages: [] }),
      });

      await service.getSession('sess_1');

      const [url, init] = (fetch as any).mock.calls[0];
      expect(url).toBe(`${baseUrl}/api/v1/inference/sessions/sess_1`);
      expect(init.method).toBeUndefined();
      expect(init.headers).toMatchObject({
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      });
    });
  });

  describe('sendMessage', () => {
    it('sends POST SSE request with correct body', async () => {
      const mockResponse = new Response();
      (fetch as any).mockResolvedValue(mockResponse);

      const result = await service.sendMessage('sess_1', 'Hello');

      expect(result).toBe(mockResponse);
      const [url, init] = (fetch as any).mock.calls[0];
      expect(url).toBe(`${baseUrl}/api/v1/inference?format=sse`);
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body).toEqual({
        messages: [{ role: 'user', content: 'Hello' }],
        sessionId: 'sess_1',
        stream: true,
      });
    });
  });

  describe('submitFeedback', () => {
    it('sends POST with messageId and rating', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await service.submitFeedback('sess_1', 'msg_1', 'up');

      const [url, init] = (fetch as any).mock.calls[0];
      expect(url).toBe(`${baseUrl}/api/v1/inference/sessions/sess_1/chat/feedback`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ messageId: 'msg_1', rating: 'up' });
    });

    it('handles down rating', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await service.submitFeedback('sess_1', 'msg_2', 'down');

      expect(JSON.parse((fetch as any).mock.calls[0][1].body).rating).toBe('down');
    });
  });

  describe('submitCsat', () => {
    it('sends POST with rating and optional comment', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await service.submitCsat('sess_1', 5, 'Great service!');

      const [url, init] = (fetch as any).mock.calls[0];
      expect(url).toBe(`${baseUrl}/api/v1/inference/sessions/sess_1/csat`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ rating: 5, comment: 'Great service!' });
    });

    it('sends rating without comment when not provided', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await service.submitCsat('sess_1', 3);

      expect(JSON.parse((fetch as any).mock.calls[0][1].body)).toEqual({
        rating: 3,
        comment: undefined,
      });
    });
  });

  describe('suggestKb', () => {
    it('returns articles on successful response', async () => {
      const articles = [{ id: '1', title: 'Help', snippet: 'How to...' }];
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ articles }),
      });

      const result = await service.suggestKb('sess_1', 'help me');

      expect(result).toEqual(articles);
      const [url] = (fetch as any).mock.calls[0];
      expect(url).toBe(`${baseUrl}/api/v1/inference/sessions/sess_1/kb/suggest?q=help%20me`);
    });

    it('returns empty array on non-OK response', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await service.suggestKb('sess_1', 'query');
      expect(result).toEqual([]);
    });

    it('returns empty array when articles key is missing', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await service.suggestKb('sess_1', 'query');
      expect(result).toEqual([]);
    });

    it('throws on fetch error (fetch rejection not caught in suggestKb)', async () => {
      (fetch as any).mockRejectedValue(new Error('Network error'));
      await expect(service.suggestKb('sess_1', 'query')).rejects.toThrow('Network error');
    });

    it('URL-encodes query parameter', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ articles: [] }),
      });

      await service.suggestKb('sess_1', 'hello world & more');
      const [url] = (fetch as any).mock.calls[0];
      expect(url).toContain('q=hello%20world%20%26%20more');
    });
  });

  describe('uploadFile', () => {
    it('sends multipart/form-data POST and returns file attachment', async () => {
      const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });
      const attachment = { fileId: 'f_1', url: 'https://cdn.example.com/test.pdf', mimeType: 'application/pdf', fileName: 'test.pdf', size: 7 };
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(attachment),
      });

      const result = await service.uploadFile('sess_1', file);

      expect(result).toEqual(attachment);
      const [url, init] = (fetch as any).mock.calls[0];
      expect(url).toBe(`${baseUrl}/api/v1/inference/sessions/sess_1/files`);
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({ Authorization: `Bearer ${apiKey}` });
      expect(init.headers['Content-Type']).toBeUndefined();
      expect(init.body).toBeInstanceOf(FormData);
    });

    it('throws error on non-OK response', async () => {
      const file = new File(['content'], 'test.pdf');
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 413,
      });

      await expect(service.uploadFile('sess_1', file)).rejects.toThrow('File upload failed: 413');
    });
  });

  describe('endSession', () => {
    it('sends DELETE request', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await service.endSession('sess_1');

      const [url, init] = (fetch as any).mock.calls[0];
      expect(url).toBe(`${baseUrl}/api/v1/inference/sessions/sess_1`);
      expect(init.method).toBe('DELETE');
    });
  });

  describe('baseUrl handling', () => {
    it('strips trailing slash from baseUrl', () => {
      const svc = new ApiService('https://example.com/', 'key');
      expect((svc as any).baseUrl).toBe('https://example.com');
    });
  });
});
