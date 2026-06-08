import { useQuery } from '@tanstack/react-query';

export interface TelegramAccount {
  id: string;
  botName: string | null;
  botUsername: string | null;
  status: string;
  agentId: string | null;
  createdAt: string;
}

async function fetchTelegramAccounts(): Promise<TelegramAccount[]> {
  const res = await fetch('/api/telegram/accounts');
  if (!res.ok) throw new Error('Failed to fetch Telegram accounts');
  return res.json();
}

export const telegramAccountKeys = {
  all: ['telegram-accounts'] as const,
  lists: () => [...telegramAccountKeys.all, 'list'] as const,
};

export function useTelegramAccounts() {
  return useQuery({ queryKey: telegramAccountKeys.lists(), queryFn: fetchTelegramAccounts });
}
