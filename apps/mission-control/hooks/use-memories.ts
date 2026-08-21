import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BASE_PATH } from '@/lib/base-path';

export type MemoryKind = 'SEMANTIC' | 'EPISODIC' | 'PROCEDURAL';

export interface MemoryRow {
  id: string;
  tenantId: string;
  userId: string;
  namespace: string;
  key: string;
  value: Record<string, unknown>;
  kind: MemoryKind;
  sourceThreadId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  supersededById: string | null;
  supersededAt: string | null;
}

export type MemorySortField = 'key' | 'createdAt' | 'updatedAt' | 'expiresAt';

export interface MemoryFilters {
  kinds?: MemoryKind[];
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: MemorySortField;
  sortDir?: 'asc' | 'desc';
}

const memoryKeys = {
  all: ['memories'] as const,
  lists: () => [...memoryKeys.all, 'list'] as const,
  list: (filters: MemoryFilters) => [...memoryKeys.lists(), filters] as const,
  details: () => [...memoryKeys.all, 'detail'] as const,
  detail: (id: string) => [...memoryKeys.details(), id] as const,
};

function buildParams(filters?: MemoryFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters?.kinds?.length) params.set('kind', filters.kinds.join(','));
  if (filters?.search?.trim()) params.set('search', filters.search.trim());
  if (filters?.sortBy) {
    params.set('sort', filters.sortBy);
    params.set('dir', filters.sortDir ?? 'desc');
  }
  params.set('limit', String(filters?.limit ?? 500));
  params.set('page', String(filters?.page ?? 1));
  return params;
}

export function useMemories(filters?: MemoryFilters) {
  return useQuery({
    queryKey: memoryKeys.list(filters ?? {}),
    queryFn: async (): Promise<{ data: MemoryRow[]; total: number }> => {
      const res = await fetch(`${BASE_PATH}/api/memories?${buildParams(filters).toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load memories');
      return { data: json.data as MemoryRow[], total: json.total ?? 0 };
    },
    placeholderData: (prev) => prev,
  });
}

// Kept for parity with the reference this was ported from; not wired into the UI yet
// (the detail dialog reads from the already-fetched list row to avoid a second round-trip).
export function useMemory(id: string | undefined) {
  return useQuery({
    queryKey: memoryKeys.detail(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<MemoryRow> => {
      const res = await fetch(`${BASE_PATH}/api/memories/${id}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load memory');
      return json.data as MemoryRow;
    },
  });
}

export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await fetch(`${BASE_PATH}/api/memories/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to delete memory');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: memoryKeys.all }),
  });
}

/**
 * Fetch every memory in the tenant for export-all. A single request up to the
 * 500-row API cap — callers compare `memories.length < total` to detect
 * truncation and warn, matching the skills/MCP export precedent.
 */
export async function fetchAllMemories(): Promise<{ memories: MemoryRow[]; total: number }> {
  const res = await fetch(`${BASE_PATH}/api/memories?limit=500&sort=updatedAt&dir=desc`);
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load memories');
  return { memories: json.data as MemoryRow[], total: json.total ?? 0 };
}
