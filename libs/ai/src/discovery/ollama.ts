import type { ModelDiscovery, DiscoveredModel } from './types';

export class OllamaModelDiscovery implements ModelDiscovery {
  async discover(credentials: Record<string, string>): Promise<DiscoveredModel[]> {
    const baseUrl = credentials.baseUrl ?? 'http://localhost:11434';
    const res = await fetch(`${baseUrl}/api/tags`);

    if (!res.ok) {
      throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);
    }

    const data: any = await res.json();
    return (data.models ?? []).map((m: any) => ({
      id: m.model ?? m.name,
      name: m.name ?? m.model,
      capabilities: ['chat' as const],
    }));
  }
}
