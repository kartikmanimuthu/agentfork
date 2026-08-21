import type { ModelDiscovery, DiscoveredModel } from './types';
import { toOllamaNativeBaseUrl } from '../ollama-url';

export class OllamaModelDiscovery implements ModelDiscovery {
  async discover(credentials: Record<string, string>): Promise<DiscoveredModel[]> {
    // Accept either spelling of the stored base URL: `/api/tags` lives on the
    // native surface, so a `/v1` suffix (the form chat needs) is stripped here.
    const baseUrl = toOllamaNativeBaseUrl(credentials.baseUrl ?? 'http://localhost:11434');
    // Local Ollama needs no auth and ignores the header; Ollama Cloud requires it.
    const headers: Record<string, string> = credentials.apiKey
      ? { Authorization: `Bearer ${credentials.apiKey}` }
      : {};
    const res = await fetch(`${baseUrl}/api/tags`, { headers });

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
