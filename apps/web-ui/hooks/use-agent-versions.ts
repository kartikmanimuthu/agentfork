import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface AgentVersion {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  aliases?: Array<{ id: string; name: string; isDefault: boolean }>;
}

async function fetchVersions(agentId: string): Promise<AgentVersion[]> {
  const res = await fetch(`/api/agents/${agentId}/versions`);
  if (!res.ok) throw new Error('Failed to fetch versions');
  return res.json();
}

async function publishVersion(agentId: string, versionId: string): Promise<AgentVersion> {
  const res = await fetch(`/api/agents/${agentId}/versions/${versionId}/publish`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to publish version');
  return res.json();
}

export const versionKeys = {
  all: (agentId: string) => ['agents', agentId, 'versions'] as const,
};

export function useAgentVersions(agentId: string) {
  return useQuery({
    queryKey: versionKeys.all(agentId),
    queryFn: () => fetchVersions(agentId),
    enabled: Boolean(agentId),
  });
}

export function usePublishAgent(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => publishVersion(agentId, versionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: versionKeys.all(agentId) });
    },
  });
}
