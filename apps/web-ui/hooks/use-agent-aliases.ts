import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface AgentAlias {
  id: string;
  name: string;
  versionId: string;
  isDefault: boolean;
  version: { version: number; status: string };
}

async function fetchAliases(agentId: string): Promise<AgentAlias[]> {
  const res = await fetch(`/api/agents/${agentId}/aliases`);
  if (!res.ok) throw new Error('Failed to fetch aliases');
  return res.json();
}

async function createAlias(agentId: string, input: { name: string; versionId: string; isDefault?: boolean }): Promise<AgentAlias> {
  const res = await fetch(`/api/agents/${agentId}/aliases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to create alias');
  }
  return res.json();
}

async function updateAlias(agentId: string, aliasId: string, input: { versionId?: string; isDefault?: boolean }): Promise<AgentAlias> {
  const res = await fetch(`/api/agents/${agentId}/aliases/${aliasId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Failed to update alias');
  return res.json();
}

async function deleteAlias(agentId: string, aliasId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/aliases/${aliasId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete alias');
}

export const aliasKeys = {
  all: (agentId: string) => ['agents', agentId, 'aliases'] as const,
};

export function useAgentAliases(agentId: string) {
  return useQuery({
    queryKey: aliasKeys.all(agentId),
    queryFn: () => fetchAliases(agentId),
    enabled: Boolean(agentId),
  });
}

export function useCreateAlias(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; versionId: string; isDefault?: boolean }) => createAlias(agentId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aliasKeys.all(agentId) });
      queryClient.invalidateQueries({ queryKey: ['agents', agentId, 'versions'] });
    },
  });
}

export function useUpdateAlias(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ aliasId, input }: { aliasId: string; input: { versionId?: string; isDefault?: boolean } }) =>
      updateAlias(agentId, aliasId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aliasKeys.all(agentId) });
      queryClient.invalidateQueries({ queryKey: ['agents', agentId, 'versions'] });
    },
  });
}

export function useDeleteAlias(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (aliasId: string) => deleteAlias(agentId, aliasId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aliasKeys.all(agentId) });
    },
  });
}
