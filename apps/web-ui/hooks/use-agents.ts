import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  type: 'simple' | 'graph';
  status: 'draft' | 'active' | 'inactive';
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentListResult {
  items: Agent[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AgentFilters {
  status?: string;
  type?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

async function fetchAgents(filters: AgentFilters = {}): Promise<AgentListResult> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
  if (filters.search) params.set('search', filters.search);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  const res = await fetch(`/api/agents?${params}`);
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

async function fetchAgent(id: string): Promise<Agent> {
  const res = await fetch(`/api/agents/${id}`);
  if (!res.ok) throw new Error('Failed to fetch agent');
  return res.json();
}

async function createAgent(input: {
  name: string;
  description?: string;
  type: 'simple' | 'graph';
  config: Record<string, unknown>;
}): Promise<Agent> {
  const res = await fetch('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to create agent');
  }
  return res.json();
}

async function updateAgent(id: string, input: Partial<Agent>): Promise<Agent> {
  const res = await fetch(`/api/agents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to update agent');
  }
  return res.json();
}

async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`/api/agents/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete agent');
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const agentKeys = {
  all: ['agents'] as const,
  lists: () => [...agentKeys.all, 'list'] as const,
  list: (filters: AgentFilters) => [...agentKeys.lists(), filters] as const,
  details: () => [...agentKeys.all, 'detail'] as const,
  detail: (id: string) => [...agentKeys.details(), id] as const,
};

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useAgents(filters: AgentFilters = {}) {
  return useQuery({
    queryKey: agentKeys.list(filters),
    queryFn: () => fetchAgents(filters),
  });
}

export function useAgent(id: string) {
  return useQuery({
    queryKey: agentKeys.detail(id),
    queryFn: () => fetchAgent(id),
    enabled: Boolean(id),
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAgent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });
}

export function useUpdateAgent(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Agent>) => updateAgent(id, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(agentKeys.detail(id), updated);
      queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAgent,
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: agentKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });
}
