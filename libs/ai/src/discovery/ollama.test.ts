import { describe, it, expect, vi, afterEach } from 'vitest';
import { OllamaModelDiscovery } from './ollama';

const tagsResponse = { models: [{ name: 'gpt-oss:120b', model: 'gpt-oss:120b' }] };

function mockFetch(body: unknown = tagsResponse, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok, status: ok ? 200 : 401, statusText: ok ? 'OK' : 'Unauthorized', json: async () => body,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('OllamaModelDiscovery', () => {
  it('strips a /v1 suffix before calling the native /api/tags route', async () => {
    const fetchMock = mockFetch();
    const models = await new OllamaModelDiscovery().discover({ baseUrl: 'https://ollama.com/v1' });
    expect(fetchMock).toHaveBeenCalledWith('https://ollama.com/api/tags', expect.anything());
    expect(models).toEqual([{ id: 'gpt-oss:120b', name: 'gpt-oss:120b', capabilities: ['chat'] }]);
  });

  it('sends the API key as a bearer token when one is configured', async () => {
    const fetchMock = mockFetch();
    await new OllamaModelDiscovery().discover({ baseUrl: 'https://ollama.com', apiKey: 'ollama-key' });
    expect(fetchMock).toHaveBeenCalledWith('https://ollama.com/api/tags', {
      headers: { Authorization: 'Bearer ollama-key' },
    });
  });

  it('omits the auth header for a keyless local daemon and defaults the host', async () => {
    const fetchMock = mockFetch();
    await new OllamaModelDiscovery().discover({});
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/tags', { headers: {} });
  });

  it('throws with the upstream status when discovery is rejected', async () => {
    mockFetch({}, false);
    await expect(new OllamaModelDiscovery().discover({ baseUrl: 'https://ollama.com' }))
      .rejects.toThrow(/401 Unauthorized/);
  });
});
