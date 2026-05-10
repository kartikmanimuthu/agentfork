import type { ModelDiscovery, DiscoveredModel } from './types';

function logDiscovery(message: string, data?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log(`[discovery:vllm] ${message}`, data ?? '');
}

export class VllmModelDiscovery implements ModelDiscovery {
  async discover(credentials: Record<string, string>): Promise<DiscoveredModel[]> {
    const baseUrl = credentials.baseUrl;
    if (!baseUrl) throw new Error('vLLM requires baseUrl');

    const url = `${baseUrl}/v1/models`;
    const headers: Record<string, string> = {};
    if (credentials.apiKey) {
      headers.Authorization = `Bearer ${credentials.apiKey}`;
    }

    logDiscovery('Fetching models', { url, hasAuth: !!credentials.apiKey });

    const res = await fetch(url, { headers });

    logDiscovery('Received response', { status: res.status, statusText: res.statusText });

    if (!res.ok) {
      throw new Error(`vLLM API error: ${res.status} ${res.statusText}`);
    }

    const data: any = await res.json();
    const models = (data.data ?? []).map((m: any) => ({
      id: m.id,
      name: m.id,
      capabilities: ['chat' as const],
    }));

    logDiscovery('Parsed models', { count: models.length });
    return models;
  }
}
