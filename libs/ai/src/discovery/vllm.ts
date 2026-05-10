import type { ModelDiscovery, DiscoveredModel } from './types';

export class VllmModelDiscovery implements ModelDiscovery {
  async discover(credentials: Record<string, string>): Promise<DiscoveredModel[]> {
    const baseUrl = credentials.baseUrl;
    if (!baseUrl) throw new Error('vLLM requires baseUrl');

    const res = await fetch(`${baseUrl}/v1/models`, {
      headers: credentials.apiKey ? { Authorization: `Bearer ${credentials.apiKey}` } : {},
    });

    if (!res.ok) {
      throw new Error(`vLLM API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return (data.data ?? []).map((m: any) => ({
      id: m.id,
      name: m.id,
      capabilities: ['chat' as const],
    }));
  }
}
