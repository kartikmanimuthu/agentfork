import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface AttachedKnowledgeBase {
  id: string;
  knowledgeBaseId: string;
  knowledgeBase: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    documentCount: number;
    chunkCount: number;
  };
}

async function fetchAttachedKBs(agentId: string): Promise<AttachedKnowledgeBase[]> {
  const res = await fetch(`/api/agents/${agentId}/knowledge-bases`);
  if (!res.ok) throw new Error('Failed to fetch attached knowledge bases');
  return res.json();
}

async function attachKB(agentId: string, knowledgeBaseId: string): Promise<AttachedKnowledgeBase> {
  const res = await fetch(`/api/agents/${agentId}/knowledge-bases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ knowledgeBaseId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to attach knowledge base');
  }
  return res.json();
}

async function detachKB(agentId: string, kbId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/knowledge-bases/${kbId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to detach knowledge base');
}

export const agentKbKeys = {
  all: (agentId: string) => ['agents', agentId, 'knowledge-bases'] as const,
};

export function useAgentKnowledgeBases(agentId: string) {
  return useQuery({
    queryKey: agentKbKeys.all(agentId),
    queryFn: () => fetchAttachedKBs(agentId),
    enabled: Boolean(agentId),
  });
}

export function useAttachKnowledgeBase(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (knowledgeBaseId: string) => attachKB(agentId, knowledgeBaseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKbKeys.all(agentId) });
    },
  });
}

export function useDetachKnowledgeBase(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kbId: string) => detachKB(agentId, kbId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKbKeys.all(agentId) });
    },
  });
}
