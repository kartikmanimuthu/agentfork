import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface AgentVersion {
  id: string;
  agentId: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

async function fetchVersions(agentId: string): Promise<AgentVersion[]> {
  const res = await fetch(`/api/agents/${agentId}/versions`);
  if (!res.ok) throw new Error('Failed to fetch versions');
  return res.json();
}

async function fetchVersion(agentId: string, versionId: string): Promise<AgentVersion> {
  const res = await fetch(`/api/agents/${agentId}/versions/${versionId}`);
  if (!res.ok) throw new Error('Failed to fetch version');
  return res.json();
}

async function createVersion(agentId: string, config: Record<string, unknown>): Promise<AgentVersion> {
  const res = await fetch(`/api/agents/${agentId}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to create version');
  }
  return res.json();
}

async function publishAgent(agentId: string): Promise<AgentVersion> {
  const res = await fetch(`/api/agents/${agentId}/publish`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to publish agent');
  }
  return res.json();
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const versionKeys = {
  all: (agentId: string) => ['agents', agentId, 'versions'] as const,
  detail: (agentId: string, versionId: string) =>
    ['agents', agentId, 'versions', versionId] as const,
};

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useAgentVersions(agentId: string) {
  return useQuery({
    queryKey: versionKeys.all(agentId),
    queryFn: () => fetchVersions(agentId),
    enabled: Boolean(agentId),
  });
}

export function useAgentVersion(agentId: string, versionId: string) {
  return useQuery({
    queryKey: versionKeys.detail(agentId, versionId),
    queryFn: () => fetchVersion(agentId, versionId),
    enabled: Boolean(agentId) && Boolean(versionId),
  });
}

export function useCreateAgentVersion(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: Record<string, unknown>) => createVersion(agentId, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: versionKeys.all(agentId) });
    },
  });
}

export function usePublishAgent(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => publishAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: versionKeys.all(agentId) });
    },
  });
}
