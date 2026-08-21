import { useQuery } from '@tanstack/react-query';

export interface WhatsAppAccountSummary {
  id: string;
  agentId: string | null;
  provider: string;
  displayPhone: string;
  displayName: string;
  status: string;
}

async function fetchWhatsAppAccounts(): Promise<WhatsAppAccountSummary[]> {
  const res = await fetch('/api/whatsapp/accounts');
  if (!res.ok) throw new Error('Failed to fetch WhatsApp accounts');
  return res.json();
}

export const whatsAppAccountKeys = {
  all: ['whatsapp-accounts'] as const,
  lists: () => [...whatsAppAccountKeys.all, 'list'] as const,
};

export function useWhatsAppAccounts() {
  return useQuery({ queryKey: whatsAppAccountKeys.lists(), queryFn: fetchWhatsAppAccounts });
}
