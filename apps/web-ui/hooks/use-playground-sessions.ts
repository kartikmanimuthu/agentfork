import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface PlaygroundSession {
  id: string;
  tenantId: string;
  userId: string;
  agentId: string;
  agentVersionId: string | null;
  name: string;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    trace?: unknown;
    createdAt?: string;
  }>;
  configOverrides: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  agentVersion?: { version: number; status: string } | null;
}

async function fetchSessions(agentId: string): Promise<PlaygroundSession[]> {
  const res = await fetch(`/api/agents/${agentId}/playground/sessions`);
  if (!res.ok) throw new Error('Failed to fetch sessions');
  return res.json();
}

async function fetchSession(agentId: string, sessionId: string): Promise<PlaygroundSession> {
  const res = await fetch(`/api/agents/${agentId}/playground/sessions/${sessionId}`);
  if (!res.ok) throw new Error('Failed to fetch session');
  return res.json();
}

async function createSession(
  agentId: string,
  input: Omit<PlaygroundSession, 'id' | 'tenantId' | 'userId' | 'agentId' | 'createdAt' | 'updatedAt' | 'agentVersion'>
): Promise<PlaygroundSession> {
  const res = await fetch(`/api/agents/${agentId}/playground/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to create session');
  }
  return res.json();
}

async function updateSession(
  agentId: string,
  sessionId: string,
  input: Partial<Pick<PlaygroundSession, 'name' | 'messages' | 'configOverrides' | 'agentVersionId'>>
): Promise<PlaygroundSession> {
  const res = await fetch(`/api/agents/${agentId}/playground/sessions/${sessionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to update session');
  }
  return res.json();
}

async function deleteSession(agentId: string, sessionId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/playground/sessions/${sessionId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete session');
}

export const playgroundSessionKeys = {
  all: (agentId: string) => ['agents', agentId, 'playground', 'sessions'] as const,
  detail: (agentId: string, sessionId: string) =>
    [...playgroundSessionKeys.all(agentId), sessionId] as const,
};

export function usePlaygroundSessions(agentId: string) {
  return useQuery({
    queryKey: playgroundSessionKeys.all(agentId),
    queryFn: () => fetchSessions(agentId),
    enabled: Boolean(agentId),
  });
}

export function usePlaygroundSession(agentId: string, sessionId: string) {
  return useQuery({
    queryKey: playgroundSessionKeys.detail(agentId, sessionId),
    queryFn: () => fetchSession(agentId, sessionId),
    enabled: Boolean(agentId) && Boolean(sessionId),
  });
}

export function useCreatePlaygroundSession(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createSession>[1]) => createSession(agentId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: playgroundSessionKeys.all(agentId) });
    },
  });
}

export function useUpdatePlaygroundSession(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, input }: { sessionId: string; input: Parameters<typeof updateSession>[2] }) =>
      updateSession(agentId, sessionId, input),
    onSuccess: (_data, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: playgroundSessionKeys.detail(agentId, sessionId) });
      queryClient.invalidateQueries({ queryKey: playgroundSessionKeys.all(agentId) });
    },
  });
}

export function useDeletePlaygroundSession(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => deleteSession(agentId, sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: playgroundSessionKeys.all(agentId) });
    },
  });
}
