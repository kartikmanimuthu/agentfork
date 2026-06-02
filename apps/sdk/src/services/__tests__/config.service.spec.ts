import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '../config.service';
import type { SdkWidgetConfig } from '../../types';

const mockConfig: SdkWidgetConfig = {
  agentId: 'agent_1',
  apiKeyPrefix: 'smc_abc123',
  theme: 'light',
  primaryColor: '#ff0000',
  secondaryColor: '#00ff00',
  position: 'right',
  headerText: 'Chat Support',
  headerIcon: null,
  botName: 'Bot',
  botAvatar: null,
  welcomeMessage: 'Hello!',
  inputPlaceholder: 'Ask me anything...',
  preChatForm: null,
  quickReplies: null,
  proactiveRules: null,
  kbEnabled: false,
  fileUpload: false,
  csatEnabled: false,
  csatType: 'thumbs',
};

describe('ConfigService', () => {
  let service: ConfigService;

  beforeEach(() => {
    service = new ConfigService('https://example.com');
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches config successfully and returns parsed data', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    });

    const result = await service.fetchConfig('sdk_123');

    expect(result).toEqual(mockConfig);
  });

  it('constructs URL with cache-bust parameter', async () => {
    const before = Date.now();
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    });

    await service.fetchConfig('sdk_123');

    const url = (fetch as any).mock.calls[0][0] as string;
    expect(url).toMatch(/^https:\/\/example\.com\/api\/v1\/sdk\/sdk_123\/config\?_t=\d+$/);
    const cacheBust = Number.parseInt(url.split('_t=')[1], 10);
    expect(cacheBust).toBeGreaterThanOrEqual(before);
    expect(cacheBust).toBeLessThanOrEqual(Date.now());
  });

  it('sets cache: no-store header', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    });

    await service.fetchConfig('sdk_123');

    expect((fetch as any).mock.calls[0][1]).toMatchObject({
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('throws error with server message on non-OK response', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: { message: 'SDK not found' } }),
    });

    await expect(service.fetchConfig('sdk_123')).rejects.toThrow('SDK not found');
  });

  it('throws error with status code when no error message in response', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });

    await expect(service.fetchConfig('sdk_123')).rejects.toThrow('Config fetch failed: 500');
  });

  it('handles JSON parse failure in error response gracefully', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('Invalid JSON')),
    });

    await expect(service.fetchConfig('sdk_123')).rejects.toThrow('Unknown error');
  });

  it('propagates network errors', async () => {
    (fetch as any).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(service.fetchConfig('sdk_123')).rejects.toThrow('Failed to fetch');
  });

  it('strips trailing slash from baseUrl', () => {
    const svc = new ConfigService('https://example.com/');
    expect((svc as any).baseUrl).toBe('https://example.com');
  });
});
