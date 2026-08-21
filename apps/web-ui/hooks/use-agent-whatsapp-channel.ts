import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { whatsAppAccountKeys } from './use-whatsapp-accounts';

interface ConnectedAccount {
  id: string;
  displayName: string;
  displayPhone: string;
  provider: string;
}

async function fetchChannel(agentId: string): Promise<{ account: ConnectedAccount | null }> {
  const res = await fetch(`/api/agents/${agentId}/channels/whatsapp`);
  if (!res.ok) throw new Error('Failed to fetch channel binding');
  return res.json();
}

async function connectChannel(agentId: string, accountId: string): Promise<{ account: ConnectedAccount }> {
  const res = await fetch(`/api/agents/${agentId}/channels/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Failed to connect channel');
  }
  return res.json();
}

async function disconnectChannel(agentId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/channels/whatsapp`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to disconnect channel');
}

export const agentChannelKeys = {
  whatsapp: (agentId: string) => ['agents', agentId, 'channels', 'whatsapp'] as const,
};

export function useAgentWhatsAppChannel(agentId: string) {
  return useQuery({
    queryKey: agentChannelKeys.whatsapp(agentId),
    queryFn: () => fetchChannel(agentId),
    enabled: Boolean(agentId),
  });
}

export function useConnectWhatsAppChannel(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => connectChannel(agentId, accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentChannelKeys.whatsapp(agentId) });
      queryClient.invalidateQueries({ queryKey: whatsAppAccountKeys.all });
    },
  });
}

export function useDisconnectWhatsAppChannel(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => disconnectChannel(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentChannelKeys.whatsapp(agentId) });
      queryClient.invalidateQueries({ queryKey: whatsAppAccountKeys.all });
    },
  });
}
