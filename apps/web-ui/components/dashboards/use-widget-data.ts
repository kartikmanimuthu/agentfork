'use client';
import { useQuery } from '@tanstack/react-query';
import type { QueryResultRow, WidgetQuerySpec } from '@/lib/dashboards/types';

export function useWidgetData(spec: WidgetQuerySpec | null) {
  return useQuery({
    queryKey: ['widget-data', spec],
    enabled: spec !== null,
    queryFn: async (): Promise<{ rows: QueryResultRow[] }> => {
      const res = await fetch('/api/dashboards/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(spec),
      });
      if (!res.ok) throw new Error('Query failed');
      return res.json();
    },
    staleTime: 1000 * 60 * 3,
  });
}
