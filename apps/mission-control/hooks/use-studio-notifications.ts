import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BASE_PATH } from '@/lib/base-path';

export interface NotificationPrefs {
  scheduledTaskFailures: boolean;
  approvalRequests: boolean;
  weeklySummary: boolean;
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new Error(data?.error ?? fallback);
  }
  return data as T;
}

async function fetchNotificationPrefs(): Promise<NotificationPrefs> {
  const res = await fetch(`${BASE_PATH}/api/studio/notifications`);
  const data = await unwrap<{ data: NotificationPrefs }>(res, 'Failed to load notification preferences');
  return data.data;
}

async function saveNotificationPrefs(prefs: NotificationPrefs): Promise<NotificationPrefs> {
  const res = await fetch(`${BASE_PATH}/api/studio/notifications`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });
  const data = await unwrap<{ data: NotificationPrefs }>(res, 'Failed to save notification preferences');
  return data.data;
}

export function useStudioNotifications() {
  return useQuery({ queryKey: ['studio-notifications'], queryFn: fetchNotificationPrefs });
}

export function useSaveStudioNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveNotificationPrefs,
    onSuccess: (data) => queryClient.setQueryData(['studio-notifications'], data),
  });
}
