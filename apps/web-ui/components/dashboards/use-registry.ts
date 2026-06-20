'use client';
import { useQuery } from '@tanstack/react-query';
import type { SourceMeta } from '@/lib/dashboards/types';

export function useRegistry() {
  return useQuery({
    queryKey: ['dashboard-registry'],
    queryFn: async (): Promise<{ sources: SourceMeta[] }> => {
      const res = await fetch('/api/dashboards/registry');
      if (!res.ok) throw new Error('Failed to load registry');
      return res.json();
    },
    staleTime: Infinity,
  });
}
