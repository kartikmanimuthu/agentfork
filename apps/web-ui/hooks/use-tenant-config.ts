import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface WebSearchConfig {
  provider: 'tavily' | 'brave' | 'searxng';
  apiKey?: string;
  apiBase?: string;
  maxResults?: number;
}

async function fetchTenantConfig<T>(key: string): Promise<T | null> {
  const res = await fetch(`/api/tenant-config?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error('Failed to fetch tenant config');
  const data = await res.json();
  return data.value as T | null;
}

async function saveTenantConfig(key: string, value: unknown): Promise<void> {
  const res = await fetch('/api/tenant-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to save tenant config');
  }
}

const tenantConfigKeys = {
  all: ['tenant-config'] as const,
  key: (key: string) => [...tenantConfigKeys.all, key] as const,
};

export function useWebSearchConfig() {
  return useQuery({
    queryKey: tenantConfigKeys.key('webSearchConfig'),
    queryFn: () => fetchTenantConfig<WebSearchConfig>('webSearchConfig'),
  });
}

export function useSaveWebSearchConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (value: WebSearchConfig) => saveTenantConfig('webSearchConfig', value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tenantConfigKeys.key('webSearchConfig') });
    },
  });
}
